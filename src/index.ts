interface Env {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  REDIRECT_URL?: string;
  KV: KVNamespace;
}

interface SpotifyAPIResponse {
  progress_ms?: number | null;
  is_playing?: boolean;
  item?: {
    album?: {
      external_urls: {
        spotify?: string;
      };
      images: {
        url: string;
        height: number | null;
        width: number | null;
      }[];
      name: string;
    };
    artists?: {
      external_urls?: {
        spotify?: string;
      };
      name?: string;
    }[];
    duration_ms?: number;
    external_urls?: {
      spotify?: string;
    };
    name?: string;
  } | null;
}

interface SpotifyNowPlaying {
  album: {
    name?: string;
    url?: string;
  };
  artists: {
    name?: string;
    url?: string;
  }[];
  duration_ms?: number;
  images: {
    url: string;
    height: number | null;
    width: number | null;
  }[];
  is_playing?: boolean;
  name?: string;
  progress_ms?: number | null;
  url?: string;
}

export default {
  // Access Tokenを使用して再生中の音楽を取得
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (env.REDIRECT_URL) {
      const code = new URL(request.url).searchParams.get('code');
      if (!code) {
        return Response.redirect(
          `https://accounts.spotify.com/authorize?${new URLSearchParams({
            response_type: 'code',
            client_id: env.CLIENT_ID,
            scope: 'user-read-currently-playing',
            redirect_uri: env.REDIRECT_URL,
          })}`,
          302
        );
      }

      const res: { access_token: string; refresh_token: string } = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(env.CLIENT_ID + ':' + env.CLIENT_SECRET)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: env.REDIRECT_URL,
        }),
      }).then((res) => {
        if (res.status !== 200) {
          throw new Error('Spotify API Error');
        }
        return res.json();
      });

      await env.KV.put('access-token', res.access_token);
      await env.KV.put('refresh-token', res.refresh_token);

      return Response.json({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
    }

    const accessToken = await env.KV.get('access-token');
    if (!accessToken) {
      throw new Error('access-token is null');
    }

    const res: SpotifyAPIResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing?market=JP', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((res) => {
      if (res.status === 204) {
        return {};
      }
      if (res.status !== 200) {
        throw new Error('Spotify API Error');
      }
      return res.json();
    });

    const nowPlaying: SpotifyNowPlaying = {
      album: { name: res.item?.album?.name, url: res?.item?.album?.external_urls.spotify },
      artists: res.item?.artists?.map((artist) => ({ name: artist.name, url: artist.external_urls?.spotify })) ?? [],
      duration_ms: res.item?.duration_ms,
      images: res.item?.album?.images.map((image) => ({ url: image.url, height: image.height, width: image.width })) ?? [],
      is_playing: res.is_playing,
      name: res.item?.name,
      progress_ms: res.progress_ms,
      url: res.item?.external_urls?.spotify,
    };
    return Response.json(nowPlaying, {
      headers: {
        'Access-Control-Allow-Origin': 'https://shadeofyou.github.io',
      },
    });
  },

  // 30分ごとにAccess Tokenを更新
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const refreshToken = await env.KV.get('refresh-token');
    if (!refreshToken) {
      throw new Error('refresh-token is null');
    }

    const res: { access_token: string; refresh_token?: string } = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(env.CLIENT_ID + ':' + env.CLIENT_SECRET)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.CLIENT_ID,
      }),
    }).then((res) => {
      if (res.status !== 200) {
        throw new Error('Spotify API Error');
      }
      return res.json();
    });

    await env.KV.put('access-token', res.access_token);
    if (res.refresh_token) {
      await env.KV.put('refresh-token', res.refresh_token);
    }
  },
};
