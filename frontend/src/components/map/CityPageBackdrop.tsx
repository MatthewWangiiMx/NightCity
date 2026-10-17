import TorontoCityViewer from '@/components/map/TorontoCityViewer';

/** Viewport-fixed city scene for Plan / Simulate — does not scroll with page content. */
export default function CityPageBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <TorontoCityViewer mode="backdrop" />
      <div className="absolute inset-0 bg-gradient-to-b from-nc-bg/55 via-nc-bg/35 to-nc-bg/70" />
    </div>
  );
}
