Page({
  data: {
    partyId: 0,
    role: 'fabric',
  },
  onLoad(query: Record<string, string>) {
    const role = query.role || 'fabric'
    this.setData({
      partyId: Number(query.id || 0),
      role,
    })
  },
})
