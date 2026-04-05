// Spotify API credentials
const clientId = process.env.REACT_APP_SPOTIFY_CLIENT_ID; // Load from .env
const redirectUri = process.env.REACT_APP_SPOTIFY_REDIRECT_URI; // Load from .env
let accessToken;

const TOKEN_KEY = "spotify_access_token";
const EXPIRES_KEY = "spotify_token_expires";
const VERIFIER_KEY = "spotify_code_verifier";

function generateRandomString(length = 64) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const randomValues = new Uint8Array(length);
    window.crypto.getRandomValues(randomValues);

    return Array.from(randomValues, (value) => possible[value % possible.length]).join("");
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(arrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

const Spotify = {
    // Uses Authorization Code with PKCE for browser apps
    async getAccessToken() {
        if(accessToken) {
            return accessToken;
        }

        // Check localStorage for an existing access token
        const storedToken = localStorage.getItem(TOKEN_KEY);
        const expirationTime = Number(localStorage.getItem(EXPIRES_KEY));

        if(storedToken && expirationTime && Date.now() < expirationTime) {
            accessToken = storedToken;
            return accessToken;
        }

        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if(code) {
            const codeVerifier = localStorage.getItem(VERIFIER_KEY);
            if(!codeVerifier) {
                throw new Error("Missing PKCE code verifier");
            }

            const body = new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: codeVerifier,
            });

            const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });

            if(!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                throw new Error(`Failed to exchange code for token: ${errorText}`);
            }

            const tokenData = await tokenResponse.json();

            accessToken = tokenData.access_token;
            localStorage.setItem(TOKEN_KEY, accessToken);
            localStorage.setItem(EXPIRES_KEY, String(Date.now() + Number(tokenData.expires_in) * 1000));

            // Clean URL by removing auth parameters
            window.history.replaceState({}, document.title, redirectUri);
            return accessToken;
        }

        // Redirect to Spotify authorization
        const codeVerifier = generateRandomString(64);
        const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
        localStorage.setItem(VERIFIER_KEY, codeVerifier);

        const scopes = "playlist-modify-public playlist-modify-private user-read-private";
        const authParams = new URLSearchParams({
            client_id: clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: scopes,
            code_challenge_method: "S256",
            code_challenge: codeChallenge,
        });

        window.location.href = `https://accounts.spotify.com/authorize?${authParams.toString()}`;
        return null;
    },

    // Method to search for tracks on Spotify
    async search(term) {
        if(!term) return [];

        const token = await this.getAccessToken();
        if(!token) return [];

        try {
            const response = await fetch(
                `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(term)}`,
                {
                    headers: { Authorization: `Bearer ${token}`},
                }
            );

            const jsonResponse = await response.json();
            if(!jsonResponse.tracks) return [];

            // Map the response to a simplified track object
            return jsonResponse.tracks.items.map((track) => ({
                id: track.id,
                name: track.name,
                artist: track.artists[0].name,
                album: track.album.name,
                uri: track.uri,
                albumArt: track.album.images[0]?.url,
            }));
        } catch (error) {
            console.error("Error searching tracks:", error);
            return [];
        }
    },

    // Method to save a playlist to Spotify
    async savePlaylist(name, trackUris) {
        if(!name || !trackUris.length) {
            console.error("Missing required data:", { name, trackUrisLength: trackUris.length });
            return;
        }

        // Validate URIs format
        const validUris = trackUris.filter((uri) => uri && uri.startsWith("spotify:track:"));
        if(validUris.length === 0) {
            console.error("No valid Spotify URIs found:", trackUris);
            throw new Error("No valid track URIs provided");
        }

        const token = await this.getAccessToken();
        if(!token) return;
        const headers = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };

        try {
            // Get user ID
            console.log("Fetching user data...");
            const userResponse = await fetch("https://api.spotify.com/v1/me", { headers });

            if(!userResponse.ok) {
                throw new Error(`Failed to get user data: ${userResponse.status}`);
            }

            const userData = await userResponse.json();
            console.log("User ID:", userData.id);

            // Create playlist
            console.log("Creating playlist...");
            const playlistResponse = await fetch(
                `https://api.spotify.com/v1/users/${userData.id}/playlists`,
                {
                    headers,
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        public: true,
                        description: "Created with Jammming",
                    }),
                }
            );

            if(!playlistResponse.ok) {
                throw new Error(`Failed to create playlist: ${playlistResponse.status}`);
            }

            const playlistData = await playlistResponse.json();
            console.log("Playlist created:", playlistData.id);

            // Add tracks to playlist
            console.log("Adding tracks to playlist...", validUris);
            const addTracksResponse = await fetch(
                `https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`,
                {
                    headers,
                    method: "POST",
                    body: JSON.stringify({ uris: validUris }),
                }
            );

            if(!addTracksResponse.ok) {
                const errorData = await addTracksResponse.json();
                console.error("Failed to add tracks to playlist", errorData);
                throw new Error(`Failed to add tracks: ${errorData.error?.message || "Unknown error"}`);
            }

            const addTracksData = await addTracksResponse.json();
            console.log("Tracks added successfully:", addTracksData);

            return playlistData.id;
        } catch (error) {
            console.error("Error saving playlist:", error);
            throw error;
        }
    },
}

export default Spotify;
