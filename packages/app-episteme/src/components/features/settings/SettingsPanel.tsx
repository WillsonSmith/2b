import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsNav } from "./SettingsNav.tsx";
import { CLOSE_ANIMATION_MS } from "./constants.ts";
import {
  StyleSection,
  WritingAidsSection,
  ModelsSection,
  PermissionsSection,
  HelpSection,
} from "./sections/index.ts";
import type { SettingsSection } from "./types.ts";
import type { WritingAidsConfig } from "../../../config.ts";

export type { SettingsSection as SettingsPanelSection } from "./types.ts";

interface SettingsPanelProps {
  onClose: () => void;
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
  onWritingAidsChange?: (aids: WritingAidsConfig) => void;
  initialSection?: SettingsSection;
}

export function SettingsPanel({
  onClose,
  onAutocompleteEnabledChange,
  onAutosaveEnabledChange,
  onWritingAidsChange,
  initialSection,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? "style");
  const [exiting, setExiting] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) return;
    setExiting(true);
    closeTimerRef.current = setTimeout(() => onClose(), CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  return (
    <div
      className={`settings-overlay${exiting ? " settings-overlay--exiting" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`settings-page${exiting ? " settings-page--exiting" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <SettingsNav active={activeSection} onChange={setActiveSection} onBack={handleClose} />
        <main className="settings-content">
          {activeSection === "style" && <StyleSection />}
          {activeSection === "writing" && <WritingAidsSection onChange={onWritingAidsChange} />}
          {activeSection === "models" && (
            <ModelsSection
              onAutocompleteEnabledChange={onAutocompleteEnabledChange}
              onAutosaveEnabledChange={onAutosaveEnabledChange}
            />
          )}
          {activeSection === "permissions" && <PermissionsSection />}
          {activeSection === "help" && <HelpSection />}
        </main>
      </div>
    </div>
  );
}
