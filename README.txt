TRAVEL TRAINING SCANNER – LOCAL TEST

1. Open the “dist” folder.
2. Double-click “index.html”.
3. Choose “Learner scanner”, then choose Bus Pass or Contactless Payment.
4. Note the four-digit pairing code.
5. Open index.html again in a second tab in the SAME browser.
6. Choose “Staff controls” and enter the pairing code.

Local mode is for testing two tabs on one computer/tablet. To link two separate
devices, add your Firebase Realtime Database details to firebase-config.js,
change enabled to true, and host the dist folder online.

On an iPad, tap Launch Full Screen. Safari may retain some browser controls.
For the cleanest full-screen result after hosting, use Share > Add to Home Screen
and launch the app from its Home Screen icon.

VERSION 2 RELIABILITY CHANGES
- Firebase now loads only when it has been configured, so it cannot delay local buttons.
- Full-screen is requested immediately from the launch tap.
- Press-and-hold uses pointer capture and no longer fails when a finger moves slightly.
- Repeated commands cancel older animation/reset timers.
- Local-storage and connection errors are handled without stopping the app.

FIREBASE SETUP – NO TERMINAL REQUIRED
1. In Firebase Console, open Build > Authentication.
2. Click Get started, then Sign-in method.
3. Open Anonymous, switch Enable on, and click Save.
4. Open Build > Realtime Database > Rules.
5. Paste the rules supplied with this build and click Publish.
6. Upload all files from this package to GitHub/Render.
