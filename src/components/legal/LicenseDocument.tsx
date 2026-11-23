import { useEffect, useRef } from 'react';
import licenseText from '../../../LICENSE?raw';

interface LicenseDocumentProps {
  className?: string;
}

/**
 * Scrollable rendering of the bundled LICENSE file.
 *
 * The raw import keeps the in-app text identical to the file shipped in
 * resources, so the license cannot drift between the installer and the UI.
 */
export function LicenseDocument({ className = '' }: LicenseDocumentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always start at the beginning, even if a previous render left the
  // container scrolled to the bottom.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto bg-gray-50 dark:bg-gray-900/40 ${className}`}
    >
      <pre className="whitespace-pre-wrap break-words p-6 text-[12px] sm:text-[13px] leading-6 text-gray-700 dark:text-gray-300 font-sans">
        {licenseText}
      </pre>
    </div>
  );
}
