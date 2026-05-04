import io
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ..shared import datasets, sanitize_for_json, EXPORTS_DIR, add_audit_log

router = APIRouter()


# ═══════════════════════════════════════════════════
# Module E: Export Engine
# ═══════════════════════════════════════════════════

class ExportConfig(BaseModel):
    dataset_id: str
    tables: list[dict]  # [{"name": "...", "headers": [...], "rows": [...], "title": "...", "subtitle": "..."}]
    format: str = "xlsx"
    filename: str = "TableForge_Export"
    options: dict = {}  # cover_page, cover_title, header_text, footer_text, page_numbers, include_raw_data, landscape


@router.post("/api/export")
async def export_tables(config: ExportConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    if config.format == "xlsx":
        return await export_excel(config)
    elif config.format == "docx":
        return await export_word(config)
    elif config.format == "csv":
        return await export_csv(config)
    elif config.format == "pdf":
        return await export_pdf(config)
    elif config.format == "python":
        return await export_python_script(config)
    else:
        raise HTTPException(400, f"Unsupported format: {config.format}")


def _is_total_row(row):
    if not row:
        return False, False
    first = str(row[0])
    is_grand = first == "Grand Total"
    is_sub = not is_grand and ("Subtotal" in first or (len(row) > 1 and str(row[1]) == "Subtotal"))
    return is_grand, is_sub


def _build_number_format(vfmt):
    decimals = vfmt.get("decimals", 2)
    style = vfmt.get("style", "number")
    separator = vfmt.get("separator", True)
    prefix = vfmt.get("prefix", "")
    suffix = vfmt.get("suffix", "")
    currency = vfmt.get("currency_symbol", "$")

    int_part = "#,##0" if separator else "0"
    dec_part = "." + "0" * decimals if decimals > 0 else ""
    nf = int_part + dec_part

    if style == "percent":
        nf = nf + '"%"'
    elif style == "currency":
        nf = f'"{currency}"{nf}'
    if prefix:
        nf = f'"{prefix}"{nf}'
    if suffix:
        nf = f'{nf}"{suffix}"'
    return nf


async def export_excel(config: ExportConfig):
    """Export with full formatting using openpyxl."""
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    output_path = EXPORTS_DIR / f"{config.filename}.xlsx"

    from openpyxl import Workbook
    wb = Workbook()
    wb.remove(wb.active)

    thin_border = Border(
        left=Side(style="thin", color="D0D0D0"),
        right=Side(style="thin", color="D0D0D0"),
        top=Side(style="thin", color="D0D0D0"),
        bottom=Side(style="thin", color="D0D0D0"),
    )

    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")[:31]
        ws = wb.create_sheet(title=name)
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        title = t.get("title", "")
        subtitle = t.get("subtitle", "")
        num_row_fields = t.get("num_row_fields", 1)
        cell_align = t.get("cell_align", "right")
        header_align = t.get("header_align", "center")
        row_label_align = t.get("row_label_align", "left")
        value_formats = t.get("value_formats", [])
        header_bg = (t.get("header_bg_color") or "1e293b").lstrip("#")
        header_tc = (t.get("header_text_color") or "FFFFFF").lstrip("#")
        total_bg = (t.get("total_bg_color") or "e8f0fe").lstrip("#")
        title_color = (t.get("title_color") or "")

        header_fill = PatternFill(start_color=header_bg or "1e293b", end_color=header_bg or "1e293b", fill_type="solid")
        header_font = Font(name="Segoe UI", size=11, bold=True, color=header_tc or "FFFFFF")
        data_font = Font(name="Segoe UI", size=10)
        total_fill = PatternFill(start_color=total_bg or "e8f0fe", end_color=total_bg or "e8f0fe", fill_type="solid")
        total_font = Font(name="Segoe UI", size=10, bold=True)
        subtotal_fill = PatternFill(start_color="f0f4f8", end_color="f0f4f8", fill_type="solid")

        row_offset = 1
        if title:
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(len(headers), 1))
            cell = ws.cell(row=1, column=1, value=title)
            tc = title_color.lstrip("#") if title_color else ""
            cell.font = Font(name="Segoe UI", size=14, bold=True, color=tc if tc else "000000")
            row_offset = 2
        if subtitle:
            ws.merge_cells(start_row=row_offset, start_column=1, end_row=row_offset, end_column=max(len(headers), 1))
            cell = ws.cell(row=row_offset, column=1, value=subtitle)
            cell.font = Font(name="Segoe UI", size=11, color="666666")
            row_offset += 1
        if title or subtitle:
            row_offset += 1

        for ci, h in enumerate(headers, 1):
            cell = ws.cell(row=row_offset, column=ci, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal=header_align, vertical="center", wrap_text=True)
            cell.border = thin_border

        ann_lookup = {}
        for ann in t.get("annotations", []):
            ann_lookup[(ann["rowIdx"], ann["colIdx"])] = ann.get("text", "")

        for ri, row in enumerate(rows, row_offset + 1):
            is_grand, is_sub = _is_total_row(row)
            data_ri = ri - row_offset - 1
            for ci, val in enumerate(row, 1):
                cell = ws.cell(row=ri, column=ci, value=val)
                cell.border = thin_border

                if is_grand:
                    cell.font = total_font
                    cell.fill = total_fill
                elif is_sub:
                    cell.font = total_font
                    cell.fill = subtotal_fill
                else:
                    cell.font = data_font

                is_val_col = (ci - 1) >= num_row_fields
                if isinstance(val, (int, float)):
                    align = cell_align if is_val_col else row_label_align
                    cell.alignment = Alignment(horizontal=align)
                    if is_val_col and value_formats:
                        vf_idx = (ci - 1 - num_row_fields) % len(value_formats)
                        cell.number_format = _build_number_format(value_formats[vf_idx])
                    else:
                        cell.number_format = '#,##0.00' if isinstance(val, float) else '#,##0'
                elif is_val_col:
                    cell.alignment = Alignment(horizontal=cell_align)
                else:
                    cell.alignment = Alignment(horizontal=row_label_align)

                ann_text = ann_lookup.get((data_ri, ci - 1))
                if ann_text:
                    from openpyxl.comments import Comment
                    comment = Comment(ann_text, "TableForge")
                    comment.width = 200
                    comment.height = 100
                    cell.comment = comment

        for ci in range(1, len(headers) + 1):
            max_len = max(
                (len(str(ws.cell(row=r, column=ci).value or "")) for r in range(row_offset, row_offset + len(rows) + 1)),
                default=10
            )
            ws.column_dimensions[get_column_letter(ci)].width = min(max(max_len + 2, 10), 40)

    # Formula-based sheet (additional sheet with SUM/AVERAGE formulas referencing raw data)
    if config.options.get("formula_export") and config.dataset_id in datasets:
        raw_df = datasets[config.dataset_id]["df"]
        formula_ws = wb.create_sheet(title="Formulas")
        formula_ws.cell(row=1, column=1, value="Formula Sheet — references Raw Data sheet")
        formula_ws.cell(row=1, column=1).font = Font(bold=True, name="Segoe UI")
        # Add SUM formulas for numeric columns
        numeric_cols = [c for c in raw_df.columns if str(raw_df[c].dtype) in ("int64", "float64")]
        formula_ws.cell(row=2, column=1, value="Column").font = Font(bold=True)
        formula_ws.cell(row=2, column=2, value="SUM").font = Font(bold=True)
        formula_ws.cell(row=2, column=3, value="AVERAGE").font = Font(bold=True)
        formula_ws.cell(row=2, column=4, value="COUNT").font = Font(bold=True)
        for r, col in enumerate(numeric_cols, 3):
            if "Raw Data" in [ws.title for ws in wb.worksheets]:
                col_letter = get_column_letter(list(raw_df.columns).index(col) + 1)
                n_rows = len(raw_df)
                formula_ws.cell(row=r, column=1, value=col)
                formula_ws.cell(row=r, column=2, value=f"='Raw Data'!{col_letter}2:{col_letter}{n_rows+1}")
                formula_ws.cell(row=r, column=3, value=f"=AVERAGE('Raw Data'!{col_letter}2:{col_letter}{n_rows+1})")
                formula_ws.cell(row=r, column=4, value=f"=COUNT('Raw Data'!{col_letter}2:{col_letter}{n_rows+1})")
            else:
                formula_ws.cell(row=r, column=1, value=col)
                formula_ws.cell(row=r, column=2, value=float(raw_df[col].sum()))
                formula_ws.cell(row=r, column=3, value=float(raw_df[col].mean()))
                formula_ws.cell(row=r, column=4, value=int(raw_df[col].count()))

    # Raw data sheet
    if config.options.get("include_raw_data") and config.dataset_id in datasets:
        raw_df = datasets[config.dataset_id]["df"]
        raw_ws = wb.create_sheet(title="Raw Data")
        raw_hdr_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
        raw_hdr_fill = PatternFill(start_color="1e293b", end_color="1e293b", fill_type="solid")
        for ci, col in enumerate(raw_df.columns, 1):
            cell = raw_ws.cell(row=1, column=ci, value=col)
            cell.font = raw_hdr_font
            cell.fill = raw_hdr_fill
        for ri, row in enumerate(raw_df.head(10000).values.tolist(), 2):
            for ci, val in enumerate(row, 1):
                raw_ws.cell(row=ri, column=ci, value=val if not (isinstance(val, float) and (np.isnan(val) or np.isinf(val))) else None)

    wb.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}


async def export_word(config: ExportConfig):
    """Export tables to a Word document with formatting."""
    from docx import Document as DocxDocument
    from docx.shared import Inches, Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    output_path = EXPORTS_DIR / f"{config.filename}.docx"
    doc = DocxDocument()
    opts = config.options or {}

    # Page setup
    from docx.enum.section import WD_ORIENT
    for section in doc.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(2)
        section.right_margin = Cm(2)
        if opts.get("landscape"):
            section.orientation = WD_ORIENT.LANDSCAPE
            section.page_width, section.page_height = section.page_height, section.page_width

    # Cover page
    if opts.get("cover_page"):
        cover_p = doc.add_paragraph()
        cover_p.add_run("\n\n\n\n")
        cover_h = doc.add_heading(opts.get("cover_title") or config.filename, level=1)
        cover_h.runs[0].font.size = Pt(28)
        if opts.get("cover_subtitle"):
            cs = doc.add_paragraph(opts["cover_subtitle"])
            cs.runs[0].font.size = Pt(14)
            cs.runs[0].font.color.rgb = RGBColor(80, 80, 80)
        doc.add_paragraph(f"\nGenerated: {datetime.now().strftime('%B %d, %Y')}")
        doc.add_page_break()

    # Header / footer
    if opts.get("header_text") or opts.get("footer_text") or opts.get("page_numbers"):
        from docx.oxml.ns import qn
        for section in doc.sections:
            if opts.get("header_text"):
                header = section.header
                hp = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
                hp.text = opts["header_text"]
                hp.runs[0].font.size = Pt(9) if hp.runs else None
            if opts.get("footer_text") or opts.get("page_numbers"):
                footer = section.footer
                fp = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
                fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                txt = opts.get("footer_text", "")
                if opts.get("page_numbers"):
                    txt = (txt + "  " if txt else "") + "Page "
                if txt:
                    fp.add_run(txt)
                if opts.get("page_numbers"):
                    from docx.oxml import OxmlElement
                    fldChar = OxmlElement('w:fldChar')
                    fldChar.set(qn('w:fldCharType'), 'begin')
                    instrText = OxmlElement('w:instrText')
                    instrText.text = "PAGE"
                    fldChar2 = OxmlElement('w:fldChar')
                    fldChar2.set(qn('w:fldCharType'), 'end')
                    run = fp.add_run()
                    run._r.append(fldChar)
                    run._r.append(instrText)
                    run._r.append(fldChar2)

    for t_idx, t in enumerate(config.tables):
        if t_idx > 0:
            doc.add_page_break()

        title = t.get("title", t.get("name", f"Table {t_idx + 1}"))
        subtitle = t.get("subtitle", "")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        formatted_rows = t.get("formatted_rows") or []
        num_row_fields = t.get("num_row_fields", 1)
        cell_align = t.get("cell_align", "right")
        header_align = t.get("header_align", "center")
        row_label_align = t.get("row_label_align", "left")

        align_map = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT}

        p = doc.add_heading(title, level=2)
        if subtitle:
            p = doc.add_paragraph(subtitle)
            p.style.font.size = Pt(10)
            p.style.font.color.rgb = RGBColor(100, 100, 100)

        if not headers:
            continue

        table = doc.add_table(rows=1 + len(formatted_rows or rows), cols=len(headers))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER

        for ci, h in enumerate(headers):
            cell = table.rows[0].cells[ci]
            cell.text = str(h)
            p = cell.paragraphs[0]
            p.alignment = align_map.get(header_align, WD_ALIGN_PARAGRAPH.CENTER)
            run = p.runs[0] if p.runs else p.add_run(str(h))
            run.bold = True
            run.font.size = Pt(9)
            run.font.name = "Segoe UI"

        ann_lookup = {}
        ann_list = []
        for ann in t.get("annotations", []):
            key = (ann["rowIdx"], ann["colIdx"])
            ann_lookup[key] = len(ann_list) + 1
            ann_list.append(ann.get("text", ""))

        use_formatted = len(formatted_rows) == len(rows)
        for ri in range(len(rows)):
            raw_row = rows[ri]
            fmt_row = formatted_rows[ri] if use_formatted else None
            is_grand, is_sub = _is_total_row(raw_row)

            for ci in range(len(headers)):
                cell = table.rows[ri + 1].cells[ci]
                if fmt_row and ci < len(fmt_row):
                    display = fmt_row[ci]
                elif ci < len(raw_row):
                    val = raw_row[ci]
                    if val is None:
                        display = ""
                    elif isinstance(val, float):
                        display = f"{val:,.2f}"
                    elif isinstance(val, int):
                        display = f"{val:,}"
                    else:
                        display = str(val)
                else:
                    display = ""

                ann_num = ann_lookup.get((ri, ci))
                if ann_num:
                    display = f"{display} [{ann_num}]"

                cell.text = display
                p = cell.paragraphs[0]
                is_val_col = ci >= num_row_fields
                p.alignment = align_map.get(cell_align if is_val_col else row_label_align, WD_ALIGN_PARAGRAPH.LEFT)

                run = p.runs[0] if p.runs else p.add_run(display)
                run.font.size = Pt(9)
                run.font.name = "Segoe UI"
                if is_grand or is_sub:
                    run.bold = True

        if ann_list:
            fn_para = doc.add_paragraph()
            fn_run = fn_para.add_run("Annotations:")
            fn_run.bold = True
            fn_run.font.size = Pt(8)
            for i, ann_text in enumerate(ann_list, 1):
                fp = doc.add_paragraph(f"[{i}] {ann_text}")
                fp.runs[0].font.size = Pt(8)
                fp.runs[0].font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    doc.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}


async def export_csv(config: ExportConfig):
    if config.tables:
        t = config.tables[0]
        output_path = EXPORTS_DIR / f"{config.filename}.csv"
        df = pd.DataFrame(t.get("rows", []), columns=t.get("headers", []))
        df.to_csv(output_path, index=False)
        fname = output_path.name
        return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}
    raise HTTPException(400, "No tables to export")


async def export_pdf(config: ExportConfig):
    """Export tables as PDF using HTML+CSS rendering."""
    output_path = EXPORTS_DIR / f"{config.filename}.pdf"
    opts = config.options or {}

    # Build HTML
    html_parts = ["""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Segoe UI, Arial, sans-serif; font-size: 11px; margin: 20px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-bottom: 2px; color: #333; }
    .subtitle { font-size: 11px; color: #666; margin-bottom: 12px; }
    .footnote { font-size: 10px; color: #666; margin-top: 4px; font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th { background: #1e293b; color: #fff; padding: 6px 10px; text-align: left; font-size: 10px; }
    td { padding: 5px 10px; border-bottom: 1px solid #ddd; font-size: 10px; }
    tr.grand-total td { background: #e8f0fe; font-weight: bold; }
    tr.subtotal td { background: #f0f4f8; font-weight: bold; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .cover { text-align: center; padding-top: 80px; page-break-after: always; }
    @media print { .cover { page-break-after: always; } }
    </style></head><body>"""]

    if opts.get("cover_page"):
        cover_title = opts.get("cover_title") or config.filename
        cover_sub = opts.get("cover_subtitle", "")
        html_parts.append(f'<div class="cover"><h1>{cover_title}</h1>')
        if cover_sub: html_parts.append(f'<p class="subtitle">{cover_sub}</p>')
        html_parts.append(f'<p style="color:#999;margin-top:40px">{datetime.now().strftime("%B %d, %Y")}</p></div>')

    if opts.get("header_text"):
        html_parts.append(f'<div style="text-align:center;color:#666;margin-bottom:16px">{opts["header_text"]}</div>')

    for t in config.tables:
        title = t.get("title", t.get("name", ""))
        subtitle = t.get("subtitle", "")
        footnote = t.get("footnote", "")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        formatted_rows = t.get("formatted_rows") or []
        num_row_fields = t.get("num_row_fields", 1)
        cell_align = t.get("cell_align", "right")
        header_align = t.get("header_align", "center")
        row_label_align = t.get("row_label_align", "left")
        use_formatted = len(formatted_rows) == len(rows)

        if title: html_parts.append(f"<h2>{title}</h2>")
        if subtitle: html_parts.append(f'<p class="subtitle">{subtitle}</p>')
        if not headers: continue

        html_parts.append("<table><thead><tr>")
        for h in headers:
            html_parts.append(f'<th style="text-align:{header_align}">{h}</th>')
        html_parts.append("</tr></thead><tbody>")

        for ri, row in enumerate(rows):
            is_grand, is_sub = _is_total_row(row)
            cls = ' class="grand-total"' if is_grand else (' class="subtotal"' if is_sub else "")
            html_parts.append(f"<tr{cls}>")
            fmt_row = formatted_rows[ri] if use_formatted and ri < len(formatted_rows) else None
            for ci in range(len(headers)):
                if fmt_row and ci < len(fmt_row):
                    display = fmt_row[ci]
                elif ci < len(row):
                    cell = row[ci]
                    if cell is None:
                        display = ""
                    elif isinstance(cell, float):
                        display = f"{cell:,.2f}"
                    elif isinstance(cell, int):
                        display = f"{cell:,}"
                    else:
                        display = str(cell)
                else:
                    display = ""
                is_val_col = ci >= num_row_fields
                align = cell_align if is_val_col else row_label_align
                bold = "font-weight:bold;" if (is_grand or is_sub) else ""
                html_parts.append(f'<td style="text-align:{align};{bold}">{display}</td>')
            html_parts.append("</tr>")

        html_parts.append("</tbody></table>")
        if footnote: html_parts.append(f'<p class="footnote">{footnote}</p>')

    if opts.get("footer_text"):
        html_parts.append(f'<div style="text-align:center;color:#999;margin-top:20px;font-size:10px">{opts["footer_text"]}</div>')

    html_parts.append("</body></html>")
    html_content = "".join(html_parts)

    # Try weasyprint, fall back to HTML file
    try:
        import weasyprint
        weasyprint.HTML(string=html_content).write_pdf(str(output_path))
    except ImportError:
        # Save as HTML with .pdf extension note
        html_path = EXPORTS_DIR / f"{config.filename}.html"
        html_path.write_text(html_content, encoding="utf-8")
        output_path = html_path
        fname = html_path.name
        return {"path": str(output_path), "message": f"PDF (as HTML) saved to {fname} — open and print to PDF", "download_filename": fname}

    fname = output_path.name
    return {"path": str(output_path), "message": f"PDF exported to {fname}", "download_filename": fname}


async def export_python_script(config: ExportConfig):
    """Generate a pandas Python script that reproduces the tables."""
    ds = datasets[config.dataset_id]
    source_file = ds.get("filepath", "your_file.xlsx")
    filename_base = Path(source_file).name

    lines = [
        "#!/usr/bin/env python3",
        '"""',
        f"TableForge Export — Generated script",
        f"Source file: {filename_base}",
        '"""',
        "",
        "import pandas as pd",
        "import numpy as np",
        "",
        f"# Load source data",
        f"df = pd.read_excel({repr(filename_base)})  # adjust path as needed",
        f"# df = pd.read_csv({repr(filename_base)})  # for CSV files",
        "",
    ]

    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        lines.append(f"# {'─' * 50}")
        lines.append(f"# {name}")
        lines.append(f"# {'─' * 50}")
        lines.append(f"# Headers: {headers}")
        lines.append(f"table_{t_idx + 1}_data = [")
        for row in rows[:5]:
            lines.append(f"    {row},")
        if len(rows) > 5:
            lines.append(f"    # ... {len(rows) - 5} more rows")
        lines.append(f"]")
        lines.append(f"table_{t_idx + 1} = pd.DataFrame(table_{t_idx + 1}_data, columns={headers})")
        lines.append(f"print('\\n{name}:')")
        lines.append(f"print(table_{t_idx + 1}.to_string(index=False))")
        lines.append("")

    lines.append("# Save to Excel")
    lines.append(f"with pd.ExcelWriter('{config.filename}.xlsx', engine='openpyxl') as writer:")
    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")
        lines.append(f"    table_{t_idx + 1}.to_excel(writer, sheet_name={repr(name[:31])}, index=False)")
    lines.append("")
    lines.append("print('\\nSaved to {}.xlsx'.format(repr(config.filename)))")

    script_content = "\n".join(lines)
    output_path = EXPORTS_DIR / f"{config.filename}.py"
    output_path.write_text(script_content, encoding="utf-8")

    add_audit_log(config.dataset_id, "export", f"Python script exported: {config.filename}.py")
    return {"message": "Python script generated", "download_filename": f"{config.filename}.py"}


# ═══════════════════════════════════════════════════
# Download exported file
# ═══════════════════════════════════════════════════

@router.get("/api/export/download/{filename}")
async def download_export(filename: str):
    filepath = EXPORTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "File not found")
    media_types = {
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".csv": "text/csv",
        ".pdf": "application/pdf",
        ".py": "text/x-python",
    }
    ext = filepath.suffix
    return FileResponse(filepath, media_type=media_types.get(ext, "application/octet-stream"), filename=filename)


# ═══════════════════════════════════════════════════
# Module J: Report Export
# ═══════════════════════════════════════════════════

class ReportExportConfig(BaseModel):
    dataset_id: str = ""
    elements: list[dict] = []
    filename: str = "TableForge_Report"


@router.post("/api/report/export")
async def export_report(config: ReportExportConfig):
    """Export a full structured report as Word document."""
    from docx import Document as DocxDocument
    from docx.shared import Inches, Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    output_path = EXPORTS_DIR / f"{config.filename}.docx"
    doc = DocxDocument()

    for section in doc.sections:
        section.top_margin = Cm(2.5)
        section.bottom_margin = Cm(2.5)
        section.left_margin = Cm(2.5)
        section.right_margin = Cm(2.5)

    now_str = datetime.now().strftime("%B %d, %Y")

    for el in config.elements:
        etype = el.get("type", "text")
        text = str(el.get("text", "")).replace("{date}", now_str)

        if etype == "cover":
            doc.add_paragraph("\n\n")
            h = doc.add_heading(text or "Report", level=1)
            h.runs[0].font.size = Pt(28)
            doc.add_paragraph(f"\n{now_str}")
            doc.add_page_break()
        elif etype == "heading":
            level = el.get("level", 1)
            doc.add_heading(text, level=level)
        elif etype == "text":
            if text:
                doc.add_paragraph(text)
        elif etype == "page_break":
            doc.add_page_break()
        elif etype == "table":
            name = el.get("name", "")
            title = el.get("title", name)
            subtitle = el.get("subtitle", "")
            headers = el.get("headers", [])
            rows = el.get("rows", [])

            if title:
                tp = doc.add_heading(title, level=3)
            if subtitle:
                sp = doc.add_paragraph(subtitle)
                if sp.runs:
                    sp.runs[0].font.size = Pt(10)
                    sp.runs[0].font.color.rgb = RGBColor(80, 80, 80)

            if headers:
                tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
                tbl.style = "Table Grid"
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER

                for ci, h in enumerate(headers):
                    cell = tbl.rows[0].cells[ci]
                    cell.text = str(h)
                    p = cell.paragraphs[0]
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = p.runs[0] if p.runs else p.add_run(str(h))
                    run.bold = True
                    run.font.size = Pt(9)

                for ri, row in enumerate(rows):
                    is_total = len(row) > 0 and str(row[0]) == "Grand Total"
                    for ci, val in enumerate(row):
                        cell = tbl.rows[ri + 1].cells[ci]
                        display = f"{val:,.2f}" if isinstance(val, float) else f"{val:,}" if isinstance(val, int) else str(val) if val is not None else ""
                        cell.text = display
                        p = cell.paragraphs[0]
                        if isinstance(val, (int, float)):
                            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                        run = p.runs[0] if p.runs else p.add_run(display)
                        run.font.size = Pt(9)
                        if is_total:
                            run.bold = True

    doc.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Report exported to {fname}", "download_filename": fname}
