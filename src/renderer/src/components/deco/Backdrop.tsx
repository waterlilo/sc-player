/**
 * The window's backdrop, all static: near-black base, the pre-rendered spray-can stipple, and the monochrome grain on
 * top (~12 fps). Everything else — panels, lists, player, menus — is stacked above, so the grain never lands on text
 * or artwork.
 */
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="sky-night absolute inset-0" />
      <div className="stipple-night absolute inset-0" />
      <div className="grain" />
    </div>
  );
}
