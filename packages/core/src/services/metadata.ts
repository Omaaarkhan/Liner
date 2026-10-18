import type {
  MetadataCandidate,
  ResolveCandidatesInput,
  ResolveCandidatesOutput,
  TrackMetadata,
  YouTubeVideoInfo
} from "@audio-ripper/shared";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";
const COVER_ART_BASE = "https://coverartarchive.org/release";
// MusicBrainz asks clients to identify themselves with a contact URL.
const USER_AGENT = "YouTubeAudioRipper/0.2.0 ( https://github.com/Omaaarkhan/YT-RIPPER )";

interface MusicBrainzSearchResponse {
  recordings?: Array<{
    id: string;
    title: string;
    score?: number;
    "artist-credit"?: Array<{
      name?: string;
      artist?: {
        name?: string;
        id?: string;
      };
    }>;
    releases?: Array<{
      id: string;
      title: string;
      date?: string;
    }>;
    isrcs?: string[];
    tags?: Array<{ name?: string }>;
  }>;
}

interface CoverArtResponse {
  images?: Array<{
    front?: boolean;
    image?: string;
    thumbnails?: {
      large?: string;
      small?: string;
    };
  }>;
}

function normalize(input: string | undefined): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  let overlap = 0;

  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export interface ParsedYoutubeTitle {
  title: string;
  artistHint?: string;
}

export function parseYoutubeTitle(rawTitle: string): ParsedYoutubeTitle {
  const cleaned = rawTitle
    .replace(/\(official.*?\)/gi, "")
    .replace(/\[official.*?\]/gi, "")
    .replace(/\(lyrics?\)/gi, "")
    .replace(/\[lyrics?\]/gi, "")
    .replace(/\(audio\)/gi, "")
    .replace(/\[audio\]/gi, "")
    .trim();

  const separators = [" - ", " – ", " — ", " | ", " : "];
  for (const separator of separators) {
    const idx = cleaned.indexOf(separator);
    if (idx > 0) {
      const artistHint = cleaned.slice(0, idx).trim();
      const title = cleaned.slice(idx + separator.length).trim();
      if (artistHint.length > 1 && title.length > 1) {
        return { title, artistHint };
      }
    }
  }

  return { title: cleaned };
}

function youtubeCandidate(video: YouTubeVideoInfo): MetadataCandidate {
  const parsed = parseYoutubeTitle(video.title);
  const artist = parsed.artistHint || video.channel || video.uploader || "Unknown Artist";

  return {
    source: "youtube",
    score: parsed.artistHint ? 0.55 : 0.4,
    coverArtUrl: video.thumbnail,
    metadata: {
      title: parsed.title,
      artist,
      album: "Unknown Album",
      albumArtist: artist
    }
  };
}

function scoreMusicBrainzMatch(
  input: ResolveCandidatesInput,
  candidateTitle: string,
  candidateArtist: string,
  searchScore: number | undefined
): number {
  const titleScore = similarity(input.title, candidateTitle);
  const artistScore = input.artistHint ? similarity(input.artistHint, candidateArtist) : 0.4;
  const mbScore = (searchScore ?? 0) / 100;

  return Math.min(1, titleScore * 0.5 + artistScore * 0.25 + mbScore * 0.25);
}

async function fetchCoverArtUrl(releaseMbid: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${COVER_ART_BASE}/${releaseMbid}`);
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as CoverArtResponse;
    const front = payload.images?.find((image) => image.front);
    return front?.thumbnails?.large ?? front?.image;
  } catch {
    return undefined;
  }
}

export async function resolveCandidates(input: ResolveCandidatesInput): Promise<ResolveCandidatesOutput> {
  const query = new URLSearchParams({
    query: `recording:"${input.title}"${input.artistHint ? ` AND artist:"${input.artistHint}"` : ""}`,
    fmt: "json",
    limit: "8"
  });

  const response = await fetch(`${MUSICBRAINZ_BASE}/recording?${query.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json"
    }
  });

  const candidates: MetadataCandidate[] = [];

  if (response.ok) {
    const payload = (await response.json()) as MusicBrainzSearchResponse;

    for (const recording of payload.recordings ?? []) {
      const artist =
        recording["artist-credit"]
          ?.map((item) => item.artist?.name || item.name)
          .filter((value): value is string => Boolean(value))
          .join(", ") || "Unknown Artist";

      const release = recording.releases?.[0];
      const score = scoreMusicBrainzMatch(input, recording.title, artist, recording.score);
      const year = release?.date ? Number.parseInt(release.date.slice(0, 4), 10) : undefined;
      const genre = recording.tags?.[0]?.name;
      const coverArtUrl = release?.id ? await fetchCoverArtUrl(release.id) : undefined;

      candidates.push({
        source: "musicbrainz",
        score,
        releaseMbid: release?.id,
        coverArtUrl,
        metadata: {
          title: recording.title,
          artist,
          album: release?.title || "Unknown Album",
          albumArtist: artist,
          year: Number.isFinite(year) ? year : undefined,
          genre,
          isrc: recording.isrcs?.[0],
          mbid: recording.id
        }
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    candidates,
    autoSelected: candidates[0]?.score >= 0.86 ? candidates[0] : undefined
  };
}

export async function resolveCandidatesFromVideo(video: YouTubeVideoInfo): Promise<ResolveCandidatesOutput> {
  const parsed = parseYoutubeTitle(video.title);

  try {
    const mbCandidates = await resolveCandidates({
      title: parsed.title,
      artistHint: parsed.artistHint || video.channel || video.uploader,
      description: video.description
    });

    const fallback = youtubeCandidate(video);
    const allCandidates = [fallback, ...mbCandidates.candidates].sort((a, b) => b.score - a.score).slice(0, 8);

    return {
      candidates: allCandidates,
      autoSelected: allCandidates[0]?.score >= 0.86 ? allCandidates[0] : undefined
    };
  } catch {
    const fallback = youtubeCandidate(video);
    return {
      candidates: [fallback],
      autoSelected: fallback
    };
  }
}
