# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2026-09-23

### Added
- Everything
- `forceFetch` option on `docOpen` and `docCreate` (`fromDoc`) to bypass the document snapshot cache for guaranteed-fresh reads when a doc may have changed outside gdocsmith

### Fixed
- `applyScript.test.ts`'s multi-tab `docOpen` coverage hit a live, hardcoded Google Doc over the network instead of a mock client; replaced with an in-memory fixture so the test no longer depends on that doc's mutable tab structure or on live credentials