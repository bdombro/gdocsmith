class Gdocsmith < Formula
  desc "Google Docs surgical authoring and workflow engine"
  homepage "https://github.com/bdombro/gdocsmith"
  version "1.0.2"
  sha256 "a906b2d3518b5da3b632e996c6d58651aca27609866c9bef6d98272dabed0caa"

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

  # Private/internal releases: default CurlDownloadStrategy cannot fetch non-public
  # GitHub release assets. Resolve the asset via the API and authenticate with
  # GitHub::API.credentials (set up via `gh auth login` or HOMEBREW_GITHUB_API_TOKEN).
  class GitHubPrivateReleaseDownloadStrategy < CurlDownloadStrategy
    def initialize(url, name, version, **meta)
      super
      pattern = %r{https://github\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/(\S+)}
      match = url.match(pattern)
      raise CurlDownloadStrategyError, "Invalid GitHub release URL: #{url}" unless match
      @owner, @repo, @tag, @filename = match.captures
    end

    def _fetch(url:, resolved_url: resolved_download_url, timeout:)
      curl_download resolved_download_url,
                    "--header", "Accept: application/octet-stream",
                    "--header", "Authorization: Bearer #{GitHub::API.credentials}",
                    to: temporary_path
    end

    private

    def resolved_download_url
      @resolved_download_url ||= begin
        asset = GitHub.get_release(@owner, @repo, @tag).fetch("assets")
          .find { |a| a["name"] == @filename }
        raise CurlDownloadStrategyError, "Release asset not found: #{@filename}" unless asset
        asset.fetch("url")
      end
    end
  end

  url "https://github.com/bdombro/gdocsmith/releases/download/v1.0.2/gdocsmith.zip",
      using: GitHubPrivateReleaseDownloadStrategy
end
