use super::commands::resolve_approved_read_file;
use crate::core::state::AppState;
use calamine::{open_workbook_auto, Reader as CalamineReader};
use quick_xml::events::Event;
use quick_xml::reader::Reader as XmlReader;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek};
use std::path::Path;
use tauri::{Runtime, State};
use zip::ZipArchive;

const MAX_DOCUMENT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_XML_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES: usize = 16 * 1024 * 1024;

const SUPPORTED_BINARY_EXTENSIONS: &[&str] = &["pdf", "docx", "xlsx", "xls", "ods", "pptx"];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExtractionMetadata {
    pub format: String,
    pub unit_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExtractionResult {
    pub text: String,
    pub metadata: DocumentExtractionMetadata,
    pub warnings: Vec<String>,
}

struct ExtractedDocument {
    text: String,
    unit_count: usize,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn extract_document_text<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    path: String,
    file_type: Option<String>,
) -> Result<DocumentExtractionResult, String> {
    let path =
        resolve_approved_read_file(app_handle, &state, path, "extract_document_text").await?;
    let extension = resolve_document_extension(&path, file_type.as_deref())?;

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("extract_document_text: failed to stat file: {error}"))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(format!(
            "extract_document_text: file exceeds the {MAX_DOCUMENT_BYTES}-byte extraction limit"
        ));
    }

    tokio::task::spawn_blocking(move || extract_document(&path, &extension))
        .await
        .map_err(|error| format!("extract_document_text task failed: {error}"))?
}

fn resolve_document_extension(path: &Path, file_type: Option<&str>) -> Result<String, String> {
    let path_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let hint_extension = file_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase());
    let extension = match path_extension {
        Some(extension) if SUPPORTED_BINARY_EXTENSIONS.contains(&extension.as_str()) => extension,
        Some(_) => {
            return Err(format!(
                "extract_document_text: unsupported document type; supported formats: {}",
                SUPPORTED_BINARY_EXTENSIONS.join(", ")
            ));
        }
        None => hint_extension
            .filter(|value| SUPPORTED_BINARY_EXTENSIONS.contains(&value.as_str()))
            .ok_or_else(|| {
                format!(
                    "extract_document_text: unsupported document type; supported formats: {}",
                    SUPPORTED_BINARY_EXTENSIONS.join(", ")
                )
            })?,
    };
    Ok(extension)
}

fn extract_document(path: &Path, extension: &str) -> Result<DocumentExtractionResult, String> {
    let mut extracted = match extension {
        "pdf" => extract_pdf(path)?,
        "docx" => {
            validate_archive(path)?;
            extract_docx(path)?
        }
        "xlsx" | "ods" => {
            validate_archive(path)?;
            extract_spreadsheet(path)?
        }
        "xls" => extract_spreadsheet(path)?,
        "pptx" => {
            validate_archive(path)?;
            extract_pptx(path)?
        }
        _ => {
            return Err(format!(
                "extract_document_text: unsupported type {extension}"
            ))
        }
    };

    extracted.text = normalize_extracted_text(&extracted.text);
    let truncated = truncate_extracted_text(&mut extracted.text);
    if truncated {
        extracted.warnings.push(format!(
            "Extracted text was truncated at {MAX_EXTRACTED_TEXT_BYTES} bytes."
        ));
    }
    if extracted.text.trim().is_empty() {
        if extension == "pdf"
            && extracted
                .warnings
                .iter()
                .any(|warning| warning.contains("require OCR"))
        {
            return Err(
                "extract_document_text: PDF contains no extractable text; scanned PDFs require OCR"
                    .to_string(),
            );
        }
        return Err(format!(
            "extract_document_text: no readable text found in {} document",
            extension.to_ascii_uppercase()
        ));
    }

    Ok(DocumentExtractionResult {
        text: extracted.text,
        metadata: DocumentExtractionMetadata {
            format: extension.to_string(),
            unit_count: extracted.unit_count,
            truncated,
        },
        warnings: extracted.warnings,
    })
}

fn extract_pdf(path: &Path) -> Result<ExtractedDocument, String> {
    let pages = pdf_extract::extract_text_by_pages(path)
        .map_err(|error| format!("extract_document_text: PDF extraction failed: {error}"))?;
    let mut text = String::new();
    let mut empty_pages = 0usize;
    for (index, page) in pages.iter().enumerate() {
        if page.trim().is_empty() {
            empty_pages += 1;
            continue;
        }
        push_boundary(&mut text, &format!("Page {}", index + 1));
        text.push_str(page.trim());
        text.push('\n');
    }

    let mut warnings = Vec::new();
    if empty_pages > 0 {
        warnings.push(format!(
            "{empty_pages} PDF page(s) contained no extractable text; scanned pages require OCR."
        ));
    }

    Ok(ExtractedDocument {
        text,
        unit_count: pages.len(),
        warnings,
    })
}

fn extract_docx(path: &Path) -> Result<ExtractedDocument, String> {
    let file = File::open(path)
        .map_err(|error| format!("extract_document_text: failed to open DOCX: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("extract_document_text: invalid DOCX archive: {error}"))?;
    let document_xml = read_zip_text_entry(&mut archive, "word/document.xml")?;
    let text = extract_ooxml_text(&document_xml)?;
    let has_media = archive
        .file_names()
        .any(|name| name.starts_with("word/media/"));
    let warnings = if has_media {
        vec!["Embedded Word media is not transcribed.".to_string()]
    } else {
        Vec::new()
    };
    let unit_count = text.lines().filter(|line| !line.trim().is_empty()).count();

    Ok(ExtractedDocument {
        text,
        unit_count,
        warnings,
    })
}

fn extract_spreadsheet(path: &Path) -> Result<ExtractedDocument, String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| format!("extract_document_text: spreadsheet open failed: {error}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut text = String::new();
    let mut non_empty_sheets = 0usize;

    for sheet_name in &sheet_names {
        let range = workbook.worksheet_range(sheet_name).map_err(|error| {
            format!("extract_document_text: failed to read sheet {sheet_name}: {error}")
        })?;
        let mut sheet_text = String::new();
        for row in range.rows() {
            let mut values = row.iter().map(ToString::to_string).collect::<Vec<String>>();
            while values.last().is_some_and(|value| value.trim().is_empty()) {
                values.pop();
            }
            if values.iter().any(|value| !value.trim().is_empty()) {
                sheet_text.push_str(&values.join("\t"));
                sheet_text.push('\n');
            }
        }
        if !sheet_text.trim().is_empty() {
            non_empty_sheets += 1;
            push_boundary(&mut text, &format!("Sheet: {sheet_name}"));
            text.push_str(sheet_text.trim_end());
            text.push('\n');
        }
    }

    let warnings = if non_empty_sheets < sheet_names.len() {
        vec![format!(
            "{} empty spreadsheet sheet(s) were skipped.",
            sheet_names.len() - non_empty_sheets
        )]
    } else {
        Vec::new()
    };
    Ok(ExtractedDocument {
        text,
        unit_count: sheet_names.len(),
        warnings,
    })
}

fn extract_pptx(path: &Path) -> Result<ExtractedDocument, String> {
    let file = File::open(path)
        .map_err(|error| format!("extract_document_text: failed to open PPTX: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("extract_document_text: invalid PPTX archive: {error}"))?;
    let mut slides = archive
        .file_names()
        .filter_map(|name| {
            let number = name
                .strip_prefix("ppt/slides/slide")?
                .strip_suffix(".xml")?
                .parse::<usize>()
                .ok()?;
            Some((number, name.to_string()))
        })
        .collect::<Vec<_>>();
    slides.sort_by_key(|(number, _)| *number);

    let has_media = archive
        .file_names()
        .any(|name| name.starts_with("ppt/media/"));
    let mut text = String::new();
    let mut empty_slides = 0usize;
    for (number, entry_name) in &slides {
        let slide_xml = read_zip_text_entry(&mut archive, entry_name)?;
        let slide_text = extract_ooxml_text(&slide_xml)?;
        if slide_text.trim().is_empty() {
            empty_slides += 1;
            continue;
        }
        push_boundary(&mut text, &format!("Slide {number}"));
        text.push_str(slide_text.trim());
        text.push('\n');
    }

    let mut warnings = Vec::new();
    if empty_slides > 0 {
        warnings.push(format!("{empty_slides} empty slide(s) were skipped."));
    }
    if has_media {
        warnings.push("Embedded PowerPoint media is not transcribed.".to_string());
    }

    Ok(ExtractedDocument {
        text,
        unit_count: slides.len(),
        warnings,
    })
}

fn extract_ooxml_text(xml: &str) -> Result<String, String> {
    let mut reader = XmlReader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut text = String::new();
    let mut inside_text = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                inside_text = event.local_name().as_ref() == b"t";
                match event.local_name().as_ref() {
                    b"tab" => text.push('\t'),
                    b"br" | b"cr" => text.push('\n'),
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) => match event.local_name().as_ref() {
                b"tab" => text.push('\t'),
                b"br" | b"cr" => text.push('\n'),
                _ => {}
            },
            Ok(Event::Text(event)) if inside_text => {
                let decoded = event.xml_content().map_err(|error| {
                    format!("extract_document_text: XML text decode failed: {error}")
                })?;
                text.push_str(&decoded);
            }
            Ok(Event::CData(event)) if inside_text => {
                let decoded = event.xml_content().map_err(|error| {
                    format!("extract_document_text: XML CDATA decode failed: {error}")
                })?;
                text.push_str(&decoded);
            }
            Ok(Event::GeneralRef(event)) if inside_text => {
                if let Some(character) = event.resolve_char_ref().map_err(|error| {
                    format!("extract_document_text: XML character reference failed: {error}")
                })? {
                    text.push(character);
                } else {
                    let name = event.decode().map_err(|error| {
                        format!("extract_document_text: XML entity decode failed: {error}")
                    })?;
                    let value = match name.as_ref() {
                        "amp" => "&",
                        "apos" => "'",
                        "gt" => ">",
                        "lt" => "<",
                        "quot" => "\"",
                        _ => {
                            return Err(format!(
                                "extract_document_text: unsupported XML entity &{name};"
                            ));
                        }
                    };
                    text.push_str(value);
                }
            }
            Ok(Event::End(event)) => match event.local_name().as_ref() {
                b"t" => inside_text = false,
                b"p" | b"tr" => text.push('\n'),
                b"tc" => text.push('\t'),
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(format!(
                    "extract_document_text: malformed Office XML: {error}"
                ));
            }
            _ => {}
        }
    }
    Ok(text)
}

fn read_zip_text_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entry_name: &str,
) -> Result<String, String> {
    let mut entry = archive.by_name(entry_name).map_err(|error| {
        format!("extract_document_text: missing archive entry {entry_name}: {error}")
    })?;
    if entry.size() > MAX_XML_ENTRY_BYTES {
        return Err(format!(
            "extract_document_text: archive entry {entry_name} exceeds the extraction limit"
        ));
    }
    let mut content = String::with_capacity(entry.size().min(usize::MAX as u64) as usize);
    entry
        .read_to_string(&mut content)
        .map_err(|error| format!("extract_document_text: failed to read {entry_name}: {error}"))?;
    Ok(content)
}

fn validate_archive(path: &Path) -> Result<(), String> {
    let file = File::open(path)
        .map_err(|error| format!("extract_document_text: failed to open archive: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("extract_document_text: invalid document archive: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "extract_document_text: archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }
    let mut expanded_size = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| {
            format!("extract_document_text: invalid archive entry {index}: {error}")
        })?;
        expanded_size = expanded_size
            .checked_add(entry.size())
            .ok_or_else(|| "extract_document_text: archive size overflow".to_string())?;
    }
    if expanded_size > MAX_ARCHIVE_EXPANDED_BYTES {
        return Err(format!(
            "extract_document_text: expanded archive exceeds the {MAX_ARCHIVE_EXPANDED_BYTES}-byte limit"
        ));
    }
    Ok(())
}

fn push_boundary(text: &mut String, label: &str) {
    if !text.is_empty() {
        text.push('\n');
    }
    text.push_str("## ");
    text.push_str(label);
    text.push('\n');
}

fn normalize_extracted_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    let mut blank_lines = 0usize;
    for line in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 && !normalized.is_empty() {
                normalized.push('\n');
            }
            continue;
        }
        blank_lines = 0;
        normalized.push_str(line);
        normalized.push('\n');
    }
    normalized.trim().to_string()
}

fn truncate_extracted_text(text: &mut String) -> bool {
    if text.len() <= MAX_EXTRACTED_TEXT_BYTES {
        return false;
    }
    let mut boundary = MAX_EXTRACTED_TEXT_BYTES;
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    text.truncate(boundary);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let file = File::create(path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, content) in entries {
            archive.start_file(*name, options).unwrap();
            archive.write_all(content.as_bytes()).unwrap();
        }
        archive.finish().unwrap();
    }

    fn write_minimal_pdf(path: &Path) {
        let stream = "BT /F1 18 Tf 72 720 Td (Hello PDF) Tj ET";
        let objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            write!(&mut pdf, "{} 0 obj\n{}\nendobj\n", index + 1, object).unwrap();
        }
        let xref_offset = pdf.len();
        write!(&mut pdf, "xref\n0 {}\n", objects.len() + 1).unwrap();
        pdf.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets {
            writeln!(&mut pdf, "{offset:010} 00000 n ").unwrap();
        }
        write!(
            &mut pdf,
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .unwrap();
        fs::write(path, pdf).unwrap();
    }

    #[test]
    fn extracts_pdf_with_page_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.pdf");
        write_minimal_pdf(&path);

        let result = extract_document(&path, "pdf").unwrap();
        assert!(result.text.contains("## Page 1"));
        assert!(result.text.contains("Hello PDF"));
        assert_eq!(result.metadata.unit_count, 1);
    }

    #[test]
    fn extracts_docx_paragraphs_and_table_cells() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.docx");
        write_zip(
            &path,
            &[(
                "word/document.xml",
                r#"<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#,
            )],
        );

        let result = extract_document(&path, "docx").unwrap();
        assert!(
            result.text.contains("Hello & welcome"),
            "unexpected DOCX text: {:?}",
            result.text
        );
        assert!(result.text.contains("A1"));
        assert!(result.text.contains("B1"));
        assert_eq!(result.metadata.format, "docx");
    }

    #[test]
    fn extracts_pptx_slides_in_numeric_order() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.pptx");
        write_zip(
            &path,
            &[
                (
                    "ppt/slides/slide10.xml",
                    r#"<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>"#,
                ),
                (
                    "ppt/slides/slide2.xml",
                    r#"<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>"#,
                ),
            ],
        );

        let result = extract_document(&path, "pptx").unwrap();
        assert!(result.text.find("## Slide 2").unwrap() < result.text.find("## Slide 10").unwrap());
        assert!(result.text.contains("Two"));
        assert!(result.text.contains("Ten"));
        assert_eq!(result.metadata.unit_count, 2);
    }

    #[test]
    fn extracts_minimal_xlsx_with_sheet_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.xlsx");
        write_zip(
            &path,
            &[
                (
                    "[Content_Types].xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
                ),
                (
                    "_rels/.rels",
                    r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
                ),
                (
                    "xl/workbook.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#,
                ),
            ],
        );

        let result = extract_document(&path, "xlsx").unwrap();
        assert!(result.text.contains("## Sheet: Budget"));
        assert!(result.text.contains("Revenue\t42"));
        assert_eq!(result.metadata.unit_count, 1);
    }

    #[test]
    fn extracts_minimal_ods_with_sheet_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.ods");
        write_zip(
            &path,
            &[
                ("mimetype", "application/vnd.oasis.opendocument.spreadsheet"),
                (
                    "META-INF/manifest.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>"#,
                ),
                (
                    "content.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Forecast"><table:table-row><table:table-cell office:value-type="string"><text:p>Region</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#,
                ),
            ],
        );

        let result = extract_document(&path, "ods").unwrap();
        assert!(result.text.contains("## Sheet: Forecast"));
        assert!(result.text.contains("Region\t7"));
        assert_eq!(result.metadata.unit_count, 1);
    }

    #[test]
    fn rejects_unsupported_document_type() {
        let path = PathBuf::from("/tmp/file.bin");
        let error = resolve_document_extension(&path, Some("bin")).unwrap_err();
        assert!(error.contains("unsupported document type"));
    }

    #[test]
    fn path_extension_cannot_be_overridden_by_a_type_hint() {
        let path = PathBuf::from("/tmp/file.exe");
        let error = resolve_document_extension(&path, Some("pdf")).unwrap_err();
        assert!(error.contains("unsupported document type"));
    }

    #[test]
    fn normalizes_blank_lines_without_losing_boundaries() {
        assert_eq!(
            normalize_extracted_text("## Page 1\r\n\r\n\r\nHello  \r\n\r\nWorld"),
            "## Page 1\n\nHello\n\nWorld"
        );
    }
}
