#!/usr/bin/env bun
/* Shared Ruby fragments and Homebrew formula generation helpers. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { $ } from "bun";
import { identityCreate } from "./createIdentity.ts";

/**
 * Parameters required to render a Homebrew formula file.
 */
export interface FormulaCoords {
  /** When true, embed private download strategy in the formula class. */
  privateRelease?: boolean;
  /** SHA-256 hex digest of the release archive at url. */
  sha256: string;
  /** Download URL for the release archive or staged file. */
  url: string;
  /** Homebrew url stanza including strategy specification. */
  urlStanza: string;
  /** Version string of the release. */
  version: string;
}

/**
 * GitHub release row used when pruning older releases.
 */
export interface ReleaseTag {
  /** Timestamp when the release was published. */
  publishedAt: string;
  /** Git tag name corresponding to the release. */
  tagName: string;
}

/**
 * Post-install and pre-uninstall guidance displayed by Homebrew.
 */
export const formulaCaveatsRuby = `def caveats
    <<~EOS
      After install or upgrade:
        ${identityCreate.key} configure install

      Before uninstall:
        ${identityCreate.key} configure uninstall
        brew uninstall <tap>/${identityCreate.key}

      Restart MCP chat apps (Cursor, Claude Desktop, etc.) after install or upgrade so they load the updated server.
    EOS
  end`;

/**
 * Ruby install block executed by Homebrew to stage binaries and completions.
 */
export const formulaInstallRuby = `def install
    bin.install "${identityCreate.key}"
    chmod 0755, bin/"${identityCreate.key}"
    generate_completions_from_executable(bin/"${identityCreate.key}", "completion", base_name: "${identityCreate.key}")
  end`;

/**
 * Ruby test block executed by `brew test` to verify binary execution and completions.
 */
export const formulaTestRuby = `test do
    assert_match version.to_s, shell_output("#{bin}/${identityCreate.key} version")
    assert_predicate bash_completion/"${identityCreate.key}", :exist?
    assert_predicate zsh_completion/"_${identityCreate.key}", :exist?
    assert_predicate fish_completion/"${identityCreate.key}.fish", :exist?
  end`;

/**
 * Ruby download strategy class resolving private GitHub release assets.
 */
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

/**
 * GitHub org/repo slug for release and purge commands.
 */
export const releaseRepoSlug = identityCreate.releaseRepo;

/**
 * Renders a Homebrew formula targeting local staged files for development.
 */
export function formulaDevRender(
  /** Absolute file path to the staged development binary. */
  stagingPath: string,
  /** Version number to embed in the formula. */
  version: string,
  /** SHA-256 digest of the staged binary. */
  sha256: string,
): string {
  const url = `file://${stagingPath}`;
  return formulaRender({
    privateRelease: false,
    sha256,
    url,
    urlStanza: urlStanzaDev(url),
    version,
  });
}

/**
 * Alias for formulaDevRender.
 */
export const renderDevFormula = formulaDevRender;

/**
 * Renders a Homebrew formula targeting GitHub release assets.
 */
export function formulaReleaseRender(
  /** Version number to embed in the formula. */
  version: string,
  /** SHA-256 digest of the release archive. */
  sha256: string,
): string {
  const url = releaseFormulaUrl(version);
  return formulaRender({
    privateRelease: true,
    sha256,
    url,
    urlStanza: urlStanzaRelease(url),
    version,
  });
}

/**
 * Alias for formulaReleaseRender.
 */
export const releaseFormulaRender = formulaReleaseRender;

/**
 * Alias for formulaReleaseRender.
 */
export const renderReleaseFormula = formulaReleaseRender;

/**
 * Renders the full Ruby Formula class definition from provided coordinates.
 */
export function formulaRender(
  /** Formula coordinate options. */
  coords: FormulaCoords,
): string {
  const strategyBlock = coords.privateRelease ? `\n${githubPrivateReleaseDownloadStrategyRuby}\n\n  ` : "";
  return `class ${identityCreate.className} < Formula
  desc "${identityCreate.desc}"
  homepage "${identityCreate.homepage}"
  version "${coords.version}"
  sha256 "${coords.sha256}"

  ${formulaInstallRuby}

  ${formulaCaveatsRuby}

  ${formulaTestRuby}
${strategyBlock}${coords.urlStanza}
end
`;
}

/**
 * Alias for formulaRender.
 */
export const renderFormula = formulaRender;

/**
 * Builds a zip archive containing the binary at root and calculates its SHA-256 checksum.
 */
export async function releaseArchiveBuild(
  /** Path to the compiled executable binary. */
  binaryPath: string,
): Promise<{ archivePath: string; sha256: string }> {
  const archivePath = `${binaryPath}.zip`;
  const result = await $`zip -j -9 ${archivePath} ${binaryPath}`.nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`zip failed: ${result.stderr}`);
  }
  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  return { archivePath, sha256 };
}

/**
 * Alias for releaseArchiveBuild.
 */
export const buildReleaseArchive = releaseArchiveBuild;

/**
 * Generates the release asset filename for GitHub releases.
 */
export function releaseArchiveName(): string {
  return `${identityCreate.key}.zip`;
}

/**
 * Generates the full download URL for a release asset on GitHub.
 */
export function releaseFormulaUrl(
  /** Release version string. */
  version: string,
): string {
  return `https://github.com/${identityCreate.releaseRepo}/releases/download/v${version}/${releaseArchiveName()}`;
}

/**
 * Filters tags to delete, keeping only the newest release by publishedAt.
 */
export function releaseTagsSelectStale(
  /** List of GitHub releases. */
  releases: ReleaseTag[],
): string[] {
  if (releases.length <= 1) {
    return [];
  }
  const sorted = [...releases].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return sorted.slice(1).map((r) => r.tagName);
}

/**
 * Alias for releaseTagsSelectStale.
 */
export const selectStaleReleaseTags = releaseTagsSelectStale;

/**
 * Generates the Homebrew url stanza for local file URLs.
 */
export function urlStanzaDev(
  /** Local file URL string. */
  url: string,
): string {
  return `url "${url}"`;
}

/**
 * Alias for urlStanzaDev.
 */
export const devUrlStanza = urlStanzaDev;

/**
 * Generates the Homebrew url stanza for GitHub release URLs with private download strategy.
 */
export function urlStanzaRelease(
  /** Asset download URL string. */
  url: string,
): string {
  return `url "${url}",
      using: GitHubPrivateReleaseDownloadStrategy`;
}

/**
 * Alias for urlStanzaRelease.
 */
export const releaseUrlStanza = urlStanzaRelease;
