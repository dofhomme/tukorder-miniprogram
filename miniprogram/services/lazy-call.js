function loadGbk() {
  return require.async('../pages/pack-lazy/gbk.js')
}

function loadSheet() {
  return require.async('../pages/pack-lazy/sheet.js')
}

function loadUg() {
  return require.async('../pages/pack-lazy/ug.js')
}

module.exports = { loadGbk, loadSheet, loadUg }
