import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { fetchMusic, extractYouTubeLinks, insertSong } from './mixer.js';
import { saveChannelId, loadChannelId } from './utils.js';
import db from './db.js';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;

const targetChannelID = loadChannelId();



/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          // Fetches a random emoji to send from a helper function
          content: `Hello world, I'm alive!`,
        },
      });
    }

    // # Set Music Channel Command
    if (name === 'setchannel') {
      const memberPermissions = req.body.member?.permissions;

      // 0x8 is ADMINISTRATOR
      if ((parseInt(memberPermissions) & 0x8) !== 0x8) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'You must be an admin to use this command.',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      // get Channel ID from options, save it to the target channel
      const channelId = data.options.find(opt => opt.name === 'channel').value;
      // Save the channel ID to a file
      saveChannelId(channelId);

      // Send a message into the channel where command was triggered from
      console.log(`Setting music channel to ${channelId}`);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Music channel set to <#${channelId}> ${getRandomEmoji()}`,
        },
      });
    }

    // Query recent songs command
    if (name === 'recentsongs') {
      try {
        const recentSongs = db.prepare('SELECT * FROM songs ORDER BY id DESC LIMIT 10').all();
    
        const responseContent = recentSongs.map(song => {
          const addedBy = `@silent <@${song.user_id}>`;
          const date = new Date(song.added_at).toLocaleDateString();
          const titleLink = `[**${song.title}**](${song.url})`;
          const albumInfo = song.album && song.album !== 'Unknown Album'
            ? `(${song.album})`
            : '';
          // If the song has no album, just show the title and artist
          return `${titleLink} by *${song.artist}*${albumInfo} • *${song.genre}*\n→ Added by ${addedBy} on ${date}`;
        }).join('\n\n');

        // const responseContent = recentSongs.map(song => {
        //   return `**${song.title}** by ${song.artist} (${song.album}) - Added by <@${song.user_id}> on ${new Date(song.added_at).toLocaleDateString()}`;
        // }).join('\n');
    
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: responseContent || 'No recent songs found.',
            flags: 4, // InteractionResponseFlags.SUPPRESS_EMBEDS
          },
        });
      } catch (err) {
        console.error('Error in recentsongs:', err);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Failed to fetch recent songs.',
            flags: 4, // InteractionResponseFlags.SUPPRESS_EMBEDS
          },
        });
      }
    }

    // Scan channel command
    if (name === 'scanmusic') {
      try {
        const messages = await fetchMusic(targetChannelID);
        const urls = extractYouTubeLinks(messages);
        const existing = db.prepare('SELECT url FROM songs').all().map(s => s.url);
      
        let newCount = 0;
        for (const { url, user } of urls) {
          if (!existing.includes(url)) {
            await insertSong({ url, user: { id: user, username: user } });
            newCount++;
          }
        }
      
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `✅ Scanned ${urls.length} links. ${newCount} new songs added.`,
          },
        });
      } catch (err) {
        console.error('Error scanning music:', err);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ An error occurred while scanning the channel.',
          },
        });
      }

    }

    // Query songs command
    if (name === 'querysongs') {
      try {
        const options = data.options || [];
        const userQuery = options.find(o => o.name === 'user')?.value?.toLowerCase();
        const artistQuery = options.find(o => o.name === 'artist')?.value?.toLowerCase();
        const titleQuery = options.find(o => o.name === 'title')?.value?.toLowerCase();
    
        let query = 'SELECT * FROM songs WHERE 1=1';
        const params = [];
    
        if (userQuery) {
          query += ' AND LOWER(user_name) LIKE ?';
          params.push(`%${userQuery}%`);
        }
        if (artistQuery) {
          query += ' AND LOWER(artist) LIKE ?';
          params.push(`%${artistQuery}%`);
        }
        if (titleQuery) {
          query += ' AND LOWER(title) LIKE ?';
          params.push(`%${titleQuery}%`);
        }
    
        query += ' ORDER BY id DESC LIMIT 10';
    
        const matches = db.prepare(query).all(...params);
    
        const responseContent = matches.length
          ? matches.map(song => {
              const addedBy = song.user_id ? `@silent <@${song.user_id}>` : `@silent @${song.user_name}`;
              const date = new Date(song.added_at).toLocaleDateString();
              const link = `[**${song.title}**](<${song.url}>)`;
              return `${link} by ${song.artist} (${song.album})\n→ Added by ${addedBy} on ${date}`;
            }).join('\n\n')
          : '❌ No matching songs found.';
    
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: responseContent,
          },
        });
      } catch (err) {
        console.error('Error in querysongs:', err);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Something went wrong while searching songs.',
          },
        });
      }
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  /**
   * Handle requests from interactive components
   * See https://discord.com/developers/docs/interactions/message-components#responding-to-a-component-interaction
   */
  if (type === InteractionType.MESSAGE_COMPONENT) {
    // custom_id set in payload when sending message component
    const componentId = data.custom_id;

    // Add your MESSAGE_COMPONENT handling logic here if needed
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});


app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
