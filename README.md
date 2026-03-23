# Reddit Profile Unhider

Chrome extension that reveals post and comment history for hidden Reddit profiles.

## How it works
1. Navigate to any Reddit user profile (reddit.com/user/username)
2. If the profile is hidden, a **"Reveal activity"** button appears below the hidden message
3. Click it to load the user's posts and comments via Reddit's search index
4. Switch between Posts / Comments tabs, and use **Load more** to paginate

## Install (Developer Mode)
1. Download and unzip this folder
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `reddit-unhider` folder
6. Done — visit any hidden Reddit profile to test

## Notes
- Data comes from Reddit's public search index (`search.json` with `author:` filter)
- Very recent posts may not appear yet (Reddit's index has a short delay)
- Works on new Reddit only (`www.reddit.com`)
- No login, no OAuth, no data stored — purely read-only

## Version 2 (planned)
- Sort bar: New · Hot · Top · Relevance
- Time filter for Top
- Old Reddit support
