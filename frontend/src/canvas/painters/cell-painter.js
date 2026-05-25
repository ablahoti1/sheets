import { COLORS } from '../constants.js'
import { cellId } from '../../utils/cells.js'

export function createCellPainter(ctx, { cw, rh, colX, rowY }) {

  // ── Public API ───────────────────────────────────────────────────────────────

  function drawRegionCells(r0, c0, r1, c1, data, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor) {
    ctx.textBaseline = 'middle'
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++)
        _drawCell(r, c, data, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor)
    }
  }

  function drawRegionBorders(r0, c0, r1, c1, getFormat, getMergeInfo, isSlave) {
    if (!getFormat) return
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++)
        _drawCellBorders(r, c, getFormat, getMergeInfo, isSlave)
    }
  }

  // ── Cell rendering ───────────────────────────────────────────────────────────

  function _drawCell(r, c, data, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor) {
    const id = cellId(r, c)
    if (isSlave && isSlave(id)) return

    const merge  = getMergeInfo && getMergeInfo(id)
    const spanC  = merge ? merge.colSpan : 1
    const spanR  = merge ? merge.rowSpan : 1
    const val    = data[id]
    const fmt    = getFormat ? getFormat(id) : {}
    const x = colX(c), y = rowY(r)

    let w = 0, h = 0
    for (let sc = 0; sc < spanC; sc++) w += cw(c + sc)
    for (let sr = 0; sr < spanR; sr++) h += rh(r + sr)

    const condFmt = getCondFormat ? getCondFormat(id, val ?? '') : null
    _drawCellBackground(x, y, w, h, merge, fmt, condFmt)
    // Data-bar from a `kind:'data-bar'` cond-format rule. Renders between
    // the cell background and the text so values stay readable on top.
    if (condFmt?.dataBar) _drawDataBar(x, y, w, h, condFmt.dataBar)
    if (getDiffFor && getDiffFor(id)) _drawDiffOverlay(x, y, w, h)

    if (getComment?.(id))     _drawCommentTriangle(x, y, w)
    if (getValidation?.(id))  _drawDropdownArrow(x, y, w, h)

    // Icon from a `kind:'icon-set'` cond-format rule. Drawn at the cell's
    // left edge and shifts the text area right so they don't overlap.
    const iconInset = condFmt?.icon ? _drawCellIcon(x, y, h, condFmt.icon) : 0

    if (val == null || val === '') return

    const s = String(val)
    const baseFmt = condFmt ? { ...fmt, ...condFmt } : fmt
    const efmt = { ...baseFmt, align: baseFmt.align || _autoAlign(s) }
    const rightInset = getRightInset ? (getRightInset(id) || 0) : 0
    _setCellFont(efmt)
    // Honour the icon's left-side reservation by shrinking the text rect.
    if (efmt.wrapText) _drawWrappedText(s, x + iconInset, y, w - iconInset, h, efmt, rightInset)
    else               _drawCellText(x + iconInset, y, w - iconInset, h, s, efmt, rightInset)
  }

  function _drawCellBackground(x, y, w, h, merge, fmt, condFmt) {
    if (merge) {
      ctx.fillStyle = COLORS.white
      ctx.fillRect(x + 1, y + 1, w - 1, h - 1)
    }
    const bg = condFmt?.backgroundColor || fmt.backgroundColor
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(x, y, w, h)
    }
  }

  // Horizontal data bar inside the cell — width is the rule's normalised
  // value (0..1). Stays a couple of px shy of the cell edges so it reads
  // as a separate visual layer from the cell background.
  function _drawDataBar(x, y, w, h, bar) {
    const PAD = 2
    const innerW = Math.max(0, w - PAD * 2)
    const innerH = Math.max(0, h - PAD * 2)
    if (!innerW || !innerH) return
    const t = Math.max(0, Math.min(1, bar.value || 0))
    const fillW = Math.round(innerW * t)
    if (!fillW) return
    ctx.save()
    ctx.fillStyle = bar.negative ? (bar.negativeColor || '#dc2626') : (bar.color || '#0E7490')
    // Faint background channel so partial bars don't look like fixed-width
    // shapes drifting in space.
    ctx.globalAlpha = 0.18
    ctx.fillRect(x + PAD, y + PAD, innerW, innerH)
    ctx.globalAlpha = 0.55
    ctx.fillRect(x + PAD, y + PAD, fillW, innerH)
    ctx.restore()
  }

  // Render the icon at the left edge of the cell. Returns the reserved
  // horizontal space so the text painter can shift right.
  function _drawCellIcon(x, y, h, icon) {
    const size  = 11
    const PAD   = 4
    const cx    = x + PAD + size / 2
    const cy    = y + h / 2
    ctx.save()
    ctx.fillStyle = icon.color || '#737373'
    switch (icon.shape) {
      case 'arrow-up':
        ctx.beginPath()
        ctx.moveTo(cx, cy - size / 2)
        ctx.lineTo(cx + size / 2, cy + size / 2)
        ctx.lineTo(cx - size / 2, cy + size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'arrow-down':
        ctx.beginPath()
        ctx.moveTo(cx, cy + size / 2)
        ctx.lineTo(cx + size / 2, cy - size / 2)
        ctx.lineTo(cx - size / 2, cy - size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'arrow-right':
        ctx.beginPath()
        ctx.moveTo(cx + size / 2, cy)
        ctx.lineTo(cx - size / 2, cy + size / 2)
        ctx.lineTo(cx - size / 2, cy - size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'circle':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'circle-empty':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = icon.color || '#737373'
        ctx.stroke()
        break
      case 'circle-half':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, Math.PI / 2, -Math.PI / 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = icon.color || '#737373'
        ctx.stroke()
        break
      case 'circle-full':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      default:
        // Unknown shape — fail quiet rather than crash a render.
        break
    }
    ctx.restore()
    return size + PAD * 2
  }

  // Diff overlay: translucent teal wash painted on top of the cell background
  // in version-preview mode.  Espresso-aligned colour, not the Google teal —
  // keeps the editor in-theme while still signalling "this cell changed".
  function _drawDiffOverlay(x, y, w, h) {
    ctx.save()
    ctx.fillStyle = 'rgba(14, 116, 144, 0.18)'   // ink-teal-7 at 18 % alpha
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  function _drawCommentTriangle(x, y, w) {
    const sz = 6
    ctx.save()
    ctx.fillStyle = '#E8523A'
    ctx.beginPath()
    ctx.moveTo(x + w - sz, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + sz)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  function _drawDropdownArrow(x, y, w, h) {
    const aw = 14, ah = h - 2
    ctx.save()
    ctx.strokeStyle = COLORS.gridLine || '#d0d0d0'
    ctx.lineWidth = 1
    ctx.strokeRect(x + w - aw, y + 1, aw - 1, ah)
    ctx.fillStyle = '#666'
    ctx.beginPath()
    const mx = x + w - aw / 2, my = y + h / 2
    ctx.moveTo(mx - 3, my - 1.5)
    ctx.lineTo(mx + 3, my - 1.5)
    ctx.lineTo(mx, my + 2.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  function _autoAlign(s) {
    return s !== '' && !isNaN(Number(s)) ? 'right' : 'left'
  }

  function _setCellFont(fmt) {
    const weight = fmt.bold   ? 'bold'   : 'normal'
    const style  = fmt.italic ? 'italic' : 'normal'
    const fontPx = Math.max(8, Math.min(72, fmt.fontSize || 13))
    const family = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.font      = `${style} ${weight} ${fontPx}px ${family}`
    ctx.fillStyle = fmt.color || (fmt.hyperlink ? '#007BE0' : COLORS.cellText)
    ctx.textAlign = fmt.align || 'left'
  }

  // ── Single-line text ─────────────────────────────────────────────────────────

  function _drawCellText(x, y, w, h, val, fmt, rightInset = 0) {
    ctx.save()
    ctx.beginPath(); ctx.rect(x + 1, y, Math.max(0, w - 2 - rightInset), h); ctx.clip()
    const { textX, textY, baseline } = _computeTextAnchor(x, y, w, h, fmt, rightInset)
    ctx.textBaseline = baseline
    ctx.fillText(val, textX, textY)
    if (fmt.underline || fmt.strikethrough || fmt.hyperlink)
      _drawTextDecorations(fmt, val, textX, _midY(baseline, textY))
    ctx.restore()
  }

  function _computeTextAnchor(x, y, w, h, fmt, rightInset = 0) {
    const innerW = w - rightInset
    const textX = fmt.align === 'center' ? x + innerW / 2
                : fmt.align === 'right'  ? x + innerW - 4
                : x + 4
    const textY = fmt.valign === 'top'    ? y + 4
                : fmt.valign === 'bottom' ? y + h - 4
                :                           y + h / 2
    const baseline = fmt.valign === 'top'    ? 'top'
                   : fmt.valign === 'bottom' ? 'bottom'
                   :                           'middle'
    return { textX, textY, baseline }
  }

  function _midY(baseline, textY) {
    if (baseline === 'top')    return textY + 7
    if (baseline === 'bottom') return textY - 7
    return textY
  }

  function _drawTextDecorations(fmt, val, textX, midY) {
    const tw  = ctx.measureText(val).width
    const lx0 = fmt.align === 'center' ? textX - tw / 2
              : fmt.align === 'right'  ? textX - tw
              : textX
    ctx.strokeStyle = fmt.color || (fmt.hyperlink ? '#007BE0' : COLORS.cellText)
    ctx.lineWidth = 1
    if (fmt.underline || fmt.hyperlink) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 8); ctx.lineTo(lx0 + tw, midY + 8)
      ctx.stroke()
    }
    if (fmt.strikethrough) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 1); ctx.lineTo(lx0 + tw, midY + 1)
      ctx.stroke()
    }
  }

  // ── Wrapped text ─────────────────────────────────────────────────────────────

  function _drawWrappedText(val, x, y, w, h, fmt, rightInset = 0) {
    const innerW = w - rightInset
    const lines = _wrapLines(val, innerW - 8)
    if (!lines.length) return
    const lineH  = 16
    const totalH = lines.length * lineH
    const startY = fmt.valign === 'top'    ? y + lineH / 2 + 2
                 : fmt.valign === 'bottom' ? y + h - totalH + lineH / 2 - 2
                 :                           y + Math.max(lineH / 2, (h - totalH) / 2 + lineH / 2)
    const textX  = fmt.align === 'center' ? x + innerW / 2
                 : fmt.align === 'right'  ? x + innerW - 4
                 : x + 4
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.beginPath(); ctx.rect(x + 1, y + 1, Math.max(0, w - 2 - rightInset), h - 2); ctx.clip()
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], textX, startY + i * lineH)
    ctx.restore()
  }

  function _wrapLines(val, maxW) {
    const tokens = val.split(/(\s+)/)
    const lines  = []
    let line = ''
    for (const tok of tokens) {
      if (!tok) continue
      if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue }
      if (/^\s+$/.test(tok)) {
        if (line.trim()) lines.push(line.trimEnd())
        line = ''; continue
      }
      for (const ch of tok) {
        if (line && ctx.measureText(line + ch).width > maxW) {
          lines.push(line.trimEnd()); line = ch
        } else { line += ch }
      }
    }
    if (line.trim()) lines.push(line.trimEnd())
    return lines
  }

  // ── Cell borders ─────────────────────────────────────────────────────────────

  function _drawCellBorders(r, c, getFormat, getMergeInfo, isSlave) {
    const id = cellId(r, c)
    if (isSlave && isSlave(id)) return
    const fmt = getFormat(id)
    if (!fmt) return

    const merge = getMergeInfo ? getMergeInfo(id) : null
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    let w = 0, h = 0
    for (let i = 0; i < spanC; i++) w += cw(c + i)
    for (let i = 0; i < spanR; i++) h += rh(r + i)
    const x = colX(c), y = rowY(r)

    if (fmt.borderTop)    _drawBorderLine(x,     y,     x + w, y,     fmt.borderTop)
    if (fmt.borderBottom) _drawBorderLine(x,     y + h, x + w, y + h, fmt.borderBottom)
    if (fmt.borderLeft)   _drawBorderLine(x,     y,     x,     y + h, fmt.borderLeft)
    if (fmt.borderRight)  _drawBorderLine(x + w, y,     x + w, y + h, fmt.borderRight)
  }

  function _drawBorderLine(x1, y1, x2, y2, border) {
    const { style = 'thin', color = '#000000' } = border
    ctx.strokeStyle = color
    ctx.lineWidth   = style === 'thick' ? 3 : style === 'medium' ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x1 + 0.5, y1 + 0.5)
    ctx.lineTo(x2 + 0.5, y2 + 0.5)
    ctx.stroke()
  }

  return { drawRegionCells, drawRegionBorders }
}
