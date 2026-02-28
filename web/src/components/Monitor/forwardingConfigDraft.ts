export function buildForwardingNextConfigForWidget(opts: {
  base: any;
  widgetId: string;
  values: any;
  normalizePath: (p?: string) => string;
}): { next: any; ownedNextSources: any[]; ownedNextChannels: any[] } {
  const { base, widgetId, values, normalizePath } = opts;
  const safeBase: any = base || { version: 1, enabled: false, sources: [], channels: [] };
  const baseChannels = Array.isArray(safeBase?.channels) ? safeBase.channels : [];
  const baseSources = Array.isArray(safeBase?.sources) ? safeBase.sources : [];

  const otherChannels = baseChannels.filter((c: any) => String(c?.ownerWidgetId || '') !== String(widgetId));
  const ownedBaseChannels = baseChannels.filter((c: any) => String(c?.ownerWidgetId || '') === String(widgetId));
  const ownedNextChannels = (Array.isArray(values?.channels) ? values.channels : ownedBaseChannels).map((c: any) => ({
    ...c,
    ownerWidgetId: widgetId,
    enabled: !!c?.enabled
  }));

  const ownedBaseSources = baseSources.filter((s: any) => String(s?.ownerWidgetId || '') === String(widgetId));
  const ownedNextSources = (Array.isArray(values?.sources) ? values.sources : ownedBaseSources).map((s: any) => ({
    ...s,
    ownerWidgetId: widgetId,
    enabled: !!s?.enabled
  }));

  const ownedPortKeys = new Set<string>(ownedNextSources.map((s: any) => normalizePath(String(s?.portPath || ''))).filter((s: string) => !!s));
  const otherSources = baseSources.filter((s: any) => {
    const owner = String(s?.ownerWidgetId || '');
    if (owner && owner === String(widgetId)) return false;
    const portKey = normalizePath(String(s?.portPath || ''));
    if (!owner && ownedPortKeys.has(portKey)) return false;
    return true;
  });

  const next = {
    ...safeBase,
    version: 1,
    enabled: [...otherChannels, ...ownedNextChannels].some((c: any) => !!c?.enabled),
    sources: [...otherSources, ...ownedNextSources],
    channels: [...otherChannels, ...ownedNextChannels]
  };

  return { next, ownedNextSources, ownedNextChannels };
}
