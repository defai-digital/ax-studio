cask "ax-studio" do
  version "1.2.0"
  sha256 :no_check # TODO: replace with actual SHA256 once the .dmg is published

  url "https://github.com/defai-digital/ax-studio/releases/download/v#{version}/Ax-Studio_#{version}_aarch64.dmg"
  name "AX Studio"
  desc "AI workspace for cloud models, local inference, tools, artifacts, and research workflows"
  homepage "https://github.com/defai-digital/ax-studio"

  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Ax-Studio.app"

  zap trash: [
    "~/Library/Application Support/Ax-Studio",
    "~/Library/Caches/ai.axstudio.app",
    "~/Library/Logs/Ax-Studio",
    "~/Library/Preferences/ai.axstudio.app.plist",
    "~/Library/Saved Application State/ai.axstudio.app.savedState",
  ]
end
