export function routedBattleWebsocketUrl(baseUrl: string, sessionId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("route", sessionId);
  return url.toString();
}
