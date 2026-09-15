/**
 * Which build this is, as the user would read it out.
 *
 * Shared because two things say it and they must agree: the indicator in the
 * menu, and the build recorded against a piece of feedback. A bug report that
 * says "86" while the screen says "v86" is one more thing for somebody to
 * work out at the moment they are already confused.
 *
 * A count renders as a version; anything else (a git-less build) is shown
 * as-is, so it cannot be mistaken for one.
 */
export const buildLabel = (): string =>
  /^\d+$/.test(__BUILD_ID__) ? `v${__BUILD_ID__}` : __BUILD_ID__
