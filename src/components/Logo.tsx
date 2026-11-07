/** The "lgtm" wordmark badge, matching the app icon. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className="logo-badge" role="img" aria-label="betterlgtm" style={{ height: size, fontSize: size * 0.56, borderRadius: size * 0.24 }}>
      lgtm
    </span>
  );
}
