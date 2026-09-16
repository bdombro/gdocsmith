class Gdocsmith < Formula
  desc "Google Docs surgical authoring and workflow engine"
  homepage "https://github.com/bdombro/gdocsmith"
  version "1.0.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  url "https://github.com/bdombro/gdocsmith/releases/download/v1.0.0/gdocsmith.zip"

  def install
    bin.install "gdocsmith"
    chmod 0755, bin/"gdocsmith"
    generate_completions_from_executable(bin/"gdocsmith", "completion", base_name: "gdocsmith")
  end

  def caveats
    <<~EOS
      After install or upgrade:
        gdocsmith configure install

      Before uninstall:
        gdocsmith configure uninstall
        brew uninstall <tap>/gdocsmith

      Restart MCP chat apps (Cursor, Claude Desktop, etc.) after install or upgrade so they load the updated server.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gdocsmith version")
    assert_predicate bash_completion/"gdocsmith", :exist?
    assert_predicate zsh_completion/"_gdocsmith", :exist?
    assert_predicate fish_completion/"gdocsmith.fish", :exist?
  end
end
