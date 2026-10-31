import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeModeProvider } from "../helpers/themeMode";
import { TooltipProvider } from "./Tooltip";
import { SonnerToaster } from "./SonnerToaster";
import { ScrollToHashElement } from "./ScrollToHashElement";
import { VisitTracker } from "./VisitTracker";
import { SeoDefaults } from "./SeoDefaults";
import { MaintenanceScreen } from "./MaintenanceScreen";
import { MAINTENANCE, clientMaintenance } from "../helpers/maintenance";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute “fresh” window
    },
  },
});

/**
 * Maintenance per domain. The server cannot see the domain, so its HTML is always the maintenance screen
 * (shadowalpha.online never ships real page content); the browser then opens the site on the open domains.
 * An inline head script hides the screen on those domains before first paint, so they show no maintenance flash.
 */
function useMaintenance() {
  const [on, setOn] = useState(MAINTENANCE);
  useEffect(() => {
    setOn(clientMaintenance(window.location.hostname));
  }, []);
  return on;
}

export const GlobalContextProviders = ({
  children,
}: {
  children: ReactNode;
}) => {
  const maintenance = useMaintenance();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        {maintenance ? <MaintenanceScreen /> : (
          <>
            <SeoDefaults />
            <ScrollToHashElement />
            <VisitTracker />
            <TooltipProvider>
              {children}
              <SonnerToaster />
            </TooltipProvider>
          </>
        )}
      </ThemeModeProvider>
    </QueryClientProvider>
  );
};
