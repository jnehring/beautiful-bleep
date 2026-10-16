// SPDX-License-Identifier: MIT
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy — Beautiful Bleep" };

// TODO(owner): fill in the [bracketed] values, name the hosting provider, and have the text checked before going live.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>
        We collect as little as possible. The site uses no analytics, no advertising and no third-party trackers.
      </p>
      <h2>Controller</h2>
      <p>[Full name, address and email, as in the <a href="/impressum/">Impressum</a>]</p>
      <h2>Browsing the site</h2>
      <p>
        The web server may log technical data such as your IP address, the page requested and the time. This is
        needed to run and secure the site (Art. 6(1)(f) GDPR). Hosting provider: [name and location].
      </p>
      <h2>Account</h2>
      <p>
        If you register we store your email address, display name, a hash of your password and the content you
        publish in the Bleep Store (Art. 6(1)(b) GDPR). Logging in sets one session cookie, which is strictly
        necessary and expires after 30 days or when you log out. We send emails only to confirm your address and to
        reset your password, through our mail provider ([provider]).
      </p>
      <h2>Contact form</h2>
      <p>
        Your name, email address and message are sent to us by email so we can answer you (Art. 6(1)(f) GDPR). We
        delete them once the matter is closed, unless the law requires us to keep them.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask for access, correction, deletion, restriction or export of your data, object to processing, and
        complain to a data protection authority. Write to us through the <a href="/contact/">contact form</a>.
      </p>
    </>
  );
}
