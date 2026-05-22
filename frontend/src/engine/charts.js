let _nextId = 1

function _id() { return `chart_${_nextId++}` }

export function createChartsEngine() {
  // { [sheetName]: Chart[] }
  // Chart: { id, type, range, title, position: {x,y,w,h} }
  const _data = {}

  function _sheet(sn) {
    if (!_data[sn]) _data[sn] = []
    return _data[sn]
  }

  function add(chart, sheetName) {
    const entry = { id: _id(), type: 'bar', title: '', ...chart }
    _sheet(sheetName).push(entry)
    return entry.id
  }

  function getAll(sheetName) {
    return _sheet(sheetName)
  }

  function update(id, patch, sheetName) {
    const chart = _sheet(sheetName).find(c => c.id === id)
    if (chart) Object.assign(chart, patch)
  }

  function remove(id, sheetName) {
    _data[sheetName] = (_data[sheetName] || []).filter(c => c.id !== id)
  }

  function serialize() {
    return JSON.parse(JSON.stringify(_data))
  }

  function hydrate(saved) {
    if (!saved) return
    Object.keys(saved).forEach(sn => {
      _data[sn] = saved[sn]
      saved[sn].forEach(c => {
        const num = parseInt((c.id || '').replace('chart_', ''), 10)
        if (!isNaN(num) && num >= _nextId) _nextId = num + 1
      })
    })
  }

  function reset() {
    Object.keys(_data).forEach(k => delete _data[k])
  }

  return { add, getAll, update, remove, serialize, hydrate, reset }
}
