import { ref } from 'vue'
import { call } from '../../utils/api.js'

// `merge` and the view-state getters/setters are optional — they were missing
// from earlier versions and their absence caused merged cells / column widths /
// freeze panes / hidden cols/rows to silently disappear after every save.
export function usePersistence({ sheet, formats, merge, comments, validation, condFormat, sortFilter, pivot, getViewState, applyViewState, currentTitle, emit }) {
  const isSaving  = ref(false)
  const saveError = ref('')

  async function loadSheet(name) {
    try {
      const doc    = await call('frappe_sheets_next.api.get_sheet', { name })
      const saved  = JSON.parse(doc.sheets_data || '{}')
      if (saved.formats)    formats.restore(saved.formats)
      sheet.restore(saved.sheet ?? { sheets: { Sheet1: {} }, current: 'Sheet1' })
      if (saved.merge      && merge?.restore)      merge.restore(saved.merge)
      if (saved.comments   && comments?.restore)   comments.restore(saved.comments)
      if (saved.validation && validation?.restore) validation.restore(saved.validation)
      if (saved.condFormat && condFormat?.restore) condFormat.restore(saved.condFormat)
      if (saved.sortFilter && sortFilter?.restore) sortFilter.restore(saved.sortFilter)
      if (saved.view       && applyViewState)      applyViewState(saved.view)
      if (saved.pivot      && pivot?.restore)      pivot.restore(saved.pivot)
      currentTitle.value = doc.title
    } catch (err) {
      console.error('Load failed:', err)
    }
  }

  // Creates a brand-new doc on the backend with the given title and returns the
  // doc name.  Called immediately on mount so every doc has a real ID from the
  // start — no manual-save step, matching Google Sheets' always-saved model.
  async function autoCreate(title) {
    return _persist(null, title || 'Untitled Spreadsheet')
  }

  async function saveExisting(name, title, { keepalive = false } = {}) {
    await _persist(name, title, { keepalive })
  }

  async function _persist(name, title, { keepalive = false } = {}) {
    isSaving.value = true
    saveError.value = ''
    try {
      const sheetsData = JSON.stringify({
        sheet:      sheet.snapshot(),
        formats:    formats.snapshot(),
        merge:      merge?.snapshot?.()      ?? null,
        comments:   comments?.snapshot?.()   ?? null,
        validation: validation?.snapshot?.() ?? null,
        condFormat: condFormat?.snapshot?.() ?? null,
        sortFilter: sortFilter?.snapshot?.() ?? null,
        pivot:      pivot?.snapshot?.()      ?? null,
        view:       getViewState?.()         ?? null,
      })
      const docName = await call('frappe_sheets_next.api.save_sheet', {
        title,
        sheets_data: sheetsData,
        ...(name ? { name } : {}),
      }, { keepalive })
      currentTitle.value = title
      return docName
    } catch (err) {
      saveError.value = err.message || 'Save failed'
      setTimeout(() => { saveError.value = '' }, 5000)
      return null
    } finally {
      isSaving.value = false
    }
  }

  return { isSaving, saveError, loadSheet, autoCreate, saveExisting }
}
