// SPDX-License-Identifier: MIT
// "Download": the standalone Bleep App for every operating system. Plugins and modules come through the app.
import DownloadList from "./DownloadList";

export const metadata = {
  title: "Download",
  description: "Download the Bleep App for macOS, Windows and Linux. Plugins, modules and presets are installed from inside the app.",
};

export default function DownloadPage() {
  return (
    <>
      <section className="hero">
        <h1>Download</h1>
        <p>Get the Bleep App, the standalone board, for your operating system. It is free and needs no login.</p>
      </section>
      <DownloadList />
      <p className="download-note">
        <strong>Note:</strong> you only download the app. All other VST plugins, modules and presets are installed
        from inside the app, in its <a href="/library/">Library</a> section. Nothing else needs to be downloaded here.
        {" "}See <a href="/docs/musicians/use/standalone/">the standalone app</a> for setup.
      </p>
      <p className="download-note">
        <strong>Unsigned builds:</strong> the downloads are not signed with a paid developer certificate, so macOS and
        Windows show a warning the first time you open them. It takes a few clicks to get past it:
        {" "}see <a href="/docs/musicians/start/unsigned-builds/">Installing unsigned builds</a>.
      </p>
    </>
  );
}
