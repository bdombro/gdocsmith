/** Shared Ruby fragments embedded in Homebrew formulae. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { $ } from "bun";
import { createIdentity } from "./create-identity.ts";

const { key, className, desc, homepage, releaseRepo } = createIdentity;

/** GitHub release row used by {@link selectStaleReleaseTags}. */
export interface ReleaseTag {
  tagName: string;
  publishedAt: string;
}

export const formulaInstallRuby = `def install
    bin.install "${key}"
    chmod 0755, bin/"${key}"
    generate_completions_from_executable(bin/"${key}", "completion", base_name: "${key}")
  end`;

export const formulaCaveatsRuby = `def caveats
    <<~EOS
      After install or upgrade:
        ${key} configure install

      Before uninstall:
        ${key} configure uninstall
        brew uninstall <tap>/${key}

      Restart MCP chat apps (Cursor, Claude Desktop, etc.) after install or upgrade so they load the updated server.
    EOS
  end`;

export const formulaTestRuby = `test do
    assert_match version.to_s, shell_output("#{bin}/${key} version")
    assert_predicate bash_completion/"${key}", :exist?
    assert_predicate zsh_completion/"_${key}", :exist?
    assert_predicate fish_completion/"${key}.fish", :exist?
  end`;

export interface FormulaCoords {
  url: string;
  urlStanza: string;
  version: string;
  /** SHA-256 hex digest of the release archive at `url` (zip for GitHub releases). */
  sha256: string;
  /** When true, embed {@link githubPrivateReleaseDownloadStrategyRuby} in the formula class. */
  privateRelease?: boolean;
}

/** Release asset filename on GitHub (zip containing the bare binary at archive root). */
export function releaseArchiveName(): string {
  return `${key}.zip`;
}

/** Build `{binaryPath}.zip` from a compiled binary; return archive path and sha256 of the zip. */
export async function buildReleaseArchive(binaryPath: string): Promise<{ archivePath: string; sha256: string }> {
  const archivePath = `${binaryPath}.zip`;
  const result = await $`zip -j -9 ${archivePath} ${binaryPath}`.nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`zip failed: ${result.stderr}`);
  }
  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  return { archivePath, sha256 };
}

/** Tags to delete when keeping only the newest release (sorted by `publishedAt` desc). */
export function selectStaleReleaseTags(releases: ReleaseTag[]): string[] {
  if (releases.length <= 1) {
    return [];
  }
  const sorted = [...releases].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return sorted.slice(1).map((r) => r.tagName);
}

/** GitHub `org/repo` slug for release and purge commands. */
export const releaseRepoSlug = releaseRepo;

/** Resolves private GitHub release assets via the API at download time. */
export const githubPrivateReleaseDownloadStrategyRuby = `  # Private/internal releases: default CurlDownloadStrategy cannot fetch non-public
  # GitHub release assets. Resolve the asset via the API and authenticate with
  # GitHub::API.credentials (set up via \`gh auth login\` or HOMEBREW_GITHUB_API_TOKEN).
  class GitHubPrivateReleaseDownloadStrategy < CurlDownloadStrategy
    def initialize(url, name, version, **meta)
      super
      pattern = %r{https://github\\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/(\\S+)}
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
  end`;

/** Homebrew `url` for local dev staging paths. */
export function devUrlStanza(url: string): string {
  return `url "${url}"`;
}

/** Homebrew `url` for GitHub release assets (uses {@link githubPrivateReleaseDownloadStrategyRuby}). */
export function releaseUrlStanza(url: string): string {
  return `url "${url}",
      using: GitHubPrivateReleaseDownloadStrategy`;
}

export function releaseFormulaUrl(version: string): string {
  return `https://github.com/${releaseRepo}/releases/download/v${version}/${releaseArchiveName()}`;
}

export function renderFormula(coords: FormulaCoords): string {
  const strategyBlock = coords.privateRelease ? `\n${githubPrivateReleaseDownloadStrategyRuby}\n\n  ` : "";
  return `class ${className} < Formula
  desc "${desc}"
  homepage "${homepage}"
  version "${coords.version}"
  sha256 "${coords.sha256}"

  ${formulaInstallRuby}

  ${formulaCaveatsRuby}

  ${formulaTestRuby}
${strategyBlock}${coords.urlStanza}
end
`;
}

export function renderReleaseFormula(version: string, sha256: string): string {
  const url = releaseFormulaUrl(version);
  return renderFormula({
    url,
    urlStanza: releaseUrlStanza(url),
    version,
    sha256,
    privateRelease: true,
  });
}

export function renderDevFormula(stagingPath: string, version: string, sha256: string): string {
  const url = `file://${stagingPath}`;
  return renderFormula({
    url,
    urlStanza: devUrlStanza(url),
    version,
    sha256,
  });
}
