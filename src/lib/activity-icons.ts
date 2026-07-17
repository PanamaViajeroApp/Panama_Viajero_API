function normalizeActivityName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getActivityIconKey(name: string): string {
  const normalizedName = normalizeActivityName(name)

  if (normalizedName.includes('delfin')) return 'binoculars'
  if (normalizedName.includes('rana roja')) return 'camera'
  if (normalizedName.includes('fotograf')) return 'camera'
  if (normalizedName.includes('lancha')) return 'boat'
  if (normalizedName.includes('cafe')) return 'coffee'
  if (normalizedName.includes('compra')) return 'store'
  if (normalizedName.includes('estrella')) return 'sparkles'
  if (normalizedName.includes('playa')) return 'parasol'
  if (normalizedName.includes('isla')) return 'tree-palm'
  if (
    normalizedName.includes('natacion')
    || normalizedName.includes('manglar')
    || normalizedName.includes('aguas termales')
    || normalizedName.includes('tortuga')
    || normalizedName.includes('fauna marina')
    || normalizedName.includes('vida marina')
  ) {
    return 'waves-horizontal'
  }

  return 'compass'
}
