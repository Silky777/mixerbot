import { google } from 'googleapis';

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

export async function getYouTubeMetadata(videoId) {
  try {
    const res = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    });

    if (res.data.items.length === 0) return null;

    const { snippet, contentDetails } = res.data.items[0];

    return {
      title: snippet.title,
      artist: snippet.channelTitle,
      album: null, // YouTube doesn't provide album
      genre: snippet.categoryId || 'Unknown Genre', // categoryId is genre-like
      duration: parseISODuration(contentDetails.duration),
    };
  } catch (err) {
    console.error('YouTube metadata fetch error:', err);
    return null;
  }
}

function parseISODuration(iso) {
  const match = iso.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  const mins = parseInt(match?.[1] || '0', 10);
  const secs = parseInt(match?.[2] || '0', 10);
  return mins * 60 + secs;
}

export function extractVideoId(url) {
  const regex = /(?:v=|\/)([0-9A-Za-z_-]{11})/;
  const match = url.match(regex);
  return match?.[1] ?? null;
}
