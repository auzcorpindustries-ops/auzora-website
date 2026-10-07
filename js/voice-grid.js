/* js/voice-grid.js — Portal voice grid display helpers (ticket
 * zeus_1791392349706_48365890 — PORTAL-VOICE).
 *
 * Pure, DOM-free helpers used by portal.html's voice grid to:
 *   1. prune the grid to the curated set the catalog flags (portal_display),
 *      while ALWAYS keeping the client's configured voice visible;
 *   2. render a region/locale indicator (flag) per voice;
 *   3. surface the configured (active) voice identifier.
 *
 * UMD-lite: exposes `window.VoiceGrid` in the browser and `module.exports`
 * under node so test/voice-grid.test.js can require it directly.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.VoiceGrid = mod;
})(typeof window !== 'undefined' ? window : null, function () {
  function isDisplayFlagged(v) {
    return !!(v && (v.portalDisplay === true || v.portal_display === true));
  }

  /**
   * Which voices the grid renders: the curated portal set (every voice the
   * backend flags portal_display), always including the configured/active voice
   * even when it falls outside the curated set — an admin must never lose sight
   * of (or the ability to keep) the client's configured voice. When the API
   * sends no portal_display flag at all (older backend) every voice is shown so
   * the grid can never render empty.
   */
  function gridVoices(voices, selectedId) {
    const all = Array.isArray(voices) ? voices.slice() : [];
    const flagged = all.filter(isDisplayFlagged);
    const base = flagged.length ? flagged : all;
    const selected = selectedId ? all.find(v => v.id === selectedId) : null;
    if (selected && !base.some(v => v.id === selectedId)) return base.concat([selected]);
    return base;
  }

  /** Normalized region descriptor for a voice, or null when it has none. */
  function voiceRegion(v) {
    if (!v) return null;
    const code = v.region || null;
    const label = v.regionLabel || v.region_label || '';
    const flag = v.regionFlag || v.region_flag || '';
    if (!code && !label && !flag) return null;
    return { code: code || 'global', label: label || '', flag: flag || '' };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Region indicator markup for a voice card: the flag (or an upper-cased
   * region code when no flag), with the full region label as a tooltip. Returns
   * '' when the voice carries no region.
   */
  function regionBadgeHtml(v) {
    const r = voiceRegion(v);
    if (!r) return '';
    const glyph = r.flag || (r.code ? r.code.toUpperCase() : '');
    if (!glyph) return '';
    return `<span class="voice-region" title="${escapeHtml(r.label || r.code)}">${glyph}</span>`;
  }

  /**
   * One-line "which voice is configured" summary for the grid header, or '' when
   * there is no configured voice. e.g. `Configured voice: 🇺🇸 Gleam`.
   */
  function configuredVoiceSummary(voices, selectedId) {
    const v = (Array.isArray(voices) ? voices : []).find(x => x.id === selectedId);
    if (!v) return '';
    const r = voiceRegion(v);
    const flag = r && r.flag ? `${r.flag} ` : '';
    return `Configured voice: ${flag}${v.label}`;
  }

  return { gridVoices, voiceRegion, regionBadgeHtml, configuredVoiceSummary, escapeHtml };
});
