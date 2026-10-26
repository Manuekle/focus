"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { useT } from "@/lib/i18n/provider";
import { TeamPanel } from "@/app/(app)/runtime/_components/team-panel";

/**
 * The team conversation, with its settings one click away in a drawer. They
 * used to be a tab on Actividad, which is where nobody running a team would
 * look for them.
 */
export function WorkingScreen() {
  const t = useT();
  const [setupOpen, setSetupOpen] = useState(false);
  return (
    <>
      <TeamPanel feedOnly fill onSetup={() => setSetupOpen(true)} />
      <Drawer open={setupOpen} onOpenChange={setSetupOpen} panelClassName="max-w-lg" closeLabel={t("agentTeam.close")}>
        <TeamPanel settingsDrawer />
      </Drawer>
    </>
  );
}
