export type OutputType = {
  sdkVersion: string;
  keyConfigured: boolean;
  webhookConfigured: boolean;
  demoEnabled: boolean;
  appUrlConfigured: boolean;
  platformFeeBps: number;
  missing: string[];
};

export const getConnectDemoConfig = async (): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/config");
  if (!result.ok) throw new Error("Connect demo configuration could not be loaded.");
  return result.json();
};
