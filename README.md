# Ad Blocker for Spotify Web
This is an experimental, simple chrome extension to remove audio ads on Spotify web player.
It's available on the [Chrome Web Store](https://chrome.google.com/webstore/detail/spotify-ads-remover/mghhlojofjipigjobacbjdngmjafdeim?hl=iw&authuser=0) too.

## How ads are removed
Ads are removed by intercepting and then tampering with Spotify's state machine requests/updates on the fly. 

The states are modified so that states that represent ads are skipped over (pointing to the state afterwards). This is done in `ads_removal.js`.

## Firefox/Safari Support
Possibly [here](https://github.com/tomer8007/spotify-web-ads-remover/pull/2) and [there](https://github.com/tomer8007/spotify-web-ads-remover/pull/8).

