const mapping = require('../../services/product-import.js')
const run = require('../../services/product-import-run.js')
const file = require('../../services/product-sheet-file.js')

module.exports = {
  autoMapping: mapping.autoMapping,
  buildImportPlan: mapping.buildImportPlan,
  columnViews: mapping.columnViews,
  fieldChoices: mapping.fieldChoices,
  looksLikeHeader: mapping.looksLikeHeader,
  commitImport: run.commitImport,
  exportFiles: run.exportFiles,
  importBusy: run.importBusy,
  setImportBusy: run.setImportBusy,
  staffUser: run.staffUser,
  readUserSheet: file.readUserSheet,
  removeExportFiles: file.removeExportFiles,
  writeExportFile: file.writeExportFile,
}
