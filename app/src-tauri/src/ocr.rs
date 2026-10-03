//! Text recognition for photos of thread-spool labels.
//!
//! macOS uses Apple's Vision framework (`VNRecognizeTextRequest`, accurate level), which runs
//! on-device and needs no model download. Other platforms report `unsupported`; the editor then
//! falls back to typing brand and code (see `engine/src/threads/label.ts`).
//!
//! The editor sends the raw image file bytes (PNG, JPEG, HEIC, ...) and gets back one entry per
//! recognised line, with a 0..1 confidence and a bounding box in image-relative coordinates
//! (origin top-left, unlike Vision's bottom-left).

use serde::Serialize;

/// A rectangle as fractions of the image: `x`/`y` is the top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct OcrBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One recognised line of text.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OcrLine {
    pub text: String,
    pub confidence: f32,
    pub bbox: OcrBox,
}

/// Refuse images bigger than this (a phone photo is 2-8 MB).
pub const MAX_IMAGE_BYTES: usize = 40 * 1024 * 1024;

/// What the editor sees when OCR can't run on this platform.
pub const UNSUPPORTED: &str = "unsupported: text recognition is only available on macOS";

/// Recognise the text in an encoded image. Blocking; call from a worker thread.
pub fn recognize_text(image: &[u8]) -> Result<Vec<OcrLine>, String> {
    if image.is_empty() {
        return Err("The image is empty.".into());
    }
    if image.len() > MAX_IMAGE_BYTES {
        return Err("The image is too large (over 40 MB).".into());
    }
    platform::recognize(image)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{OcrBox, OcrLine};
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizedTextObservation, VNRequest,
        VNRequestTextRecognitionLevel,
    };

    pub fn recognize(image: &[u8]) -> Result<Vec<OcrLine>, String> {
        autoreleasepool(|_| {
            let data = NSData::with_bytes(image);
            let request = VNRecognizeTextRequest::new();
            request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
            // Spool codes are numbers, not words: dictionary "correction" would only damage them.
            request.setUsesLanguageCorrection(false);

            let options: Retained<NSDictionary<objc2_foundation::NSString, AnyObject>> =
                NSDictionary::new();
            let handler =
                VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);
            let as_request: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
            let requests = NSArray::from_retained_slice(&[as_request]);
            handler
                .performRequests_error(&requests)
                .map_err(|e| format!("Vision could not read the image: {}", e.localizedDescription()))?;

            let mut lines = Vec::new();
            let Some(results) = request.results() else {
                return Ok(lines);
            };
            for obs in results.iter() {
                let Ok(obs) = obs.downcast::<VNRecognizedTextObservation>() else {
                    continue;
                };
                let candidates = obs.topCandidates(1);
                let Some(best) = candidates.iter().next() else {
                    continue;
                };
                let text = best.string().to_string();
                if text.trim().is_empty() {
                    continue;
                }
                let b = unsafe { obs.boundingBox() };
                lines.push(OcrLine {
                    text,
                    confidence: best.confidence(),
                    bbox: OcrBox {
                        x: b.origin.x,
                        // Vision's origin is bottom-left; flip to top-left.
                        y: 1.0 - (b.origin.y + b.size.height),
                        width: b.size.width,
                        height: b.size.height,
                    },
                });
            }
            // top to bottom, then left to right: reading order
            lines.sort_by(|a, b| {
                a.bbox
                    .y
                    .partial_cmp(&b.bbox.y)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.bbox.x.partial_cmp(&b.bbox.x).unwrap_or(std::cmp::Ordering::Equal))
            });
            Ok(lines)
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{OcrLine, UNSUPPORTED};

    pub fn recognize(_image: &[u8]) -> Result<Vec<OcrLine>, String> {
        Err(UNSUPPORTED.to_string())
    }
}

/// `ocr_image(bytes) -> [{text, confidence, bbox}]`. The editor passes the image bytes as the raw
/// request body (a `Uint8Array`); a JSON array of numbers is accepted too.
#[tauri::command]
pub async fn ocr_image(request: tauri::ipc::Request<'_>) -> Result<Vec<OcrLine>, String> {
    let bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        tauri::ipc::InvokeBody::Json(v) => serde_json::from_value(v.clone())
            .map_err(|_| "ocr_image expects the image bytes".to_string())?,
    };
    tauri::async_runtime::spawn_blocking(move || recognize_text(&bytes))
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_oversized_input() {
        assert!(recognize_text(&[]).unwrap_err().contains("empty"));
        let big = vec![0u8; MAX_IMAGE_BYTES + 1];
        assert!(recognize_text(&big).unwrap_err().contains("too large"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_platforms_say_unsupported() {
        assert!(recognize_text(&[1, 2, 3]).unwrap_err().starts_with("unsupported"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn garbage_bytes_are_an_error_not_a_crash() {
        assert!(recognize_text(b"definitely not an image").is_err());
    }

    /// A rendered spool label (MADEIRA / POLYNEON / No. 40 / 1747 / 5000 m).
    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_spool_label_fixture() {
        let png = include_bytes!("../tests/fixtures/spool-label.png");
        let lines = recognize_text(png).expect("Vision should read the fixture");
        let all: Vec<String> = lines.iter().map(|l| l.text.to_uppercase()).collect();
        let joined = all.join(" | ");
        println!("OCR lines: {joined}");
        assert!(joined.contains("MADEIRA"), "brand missing in: {joined}");
        assert!(joined.contains("1747"), "colour code missing in: {joined}");
        for l in &lines {
            assert!((0.0..=1.0).contains(&l.confidence), "confidence out of range: {}", l.confidence);
            assert!(l.bbox.x >= -0.01 && l.bbox.y >= -0.01 && l.bbox.x + l.bbox.width <= 1.01 && l.bbox.y + l.bbox.height <= 1.01);
        }
        // reading order: MADEIRA is above the code
        let y_of = |needle: &str| lines.iter().find(|l| l.text.to_uppercase().contains(needle)).map(|l| l.bbox.y);
        assert!(y_of("MADEIRA").unwrap() < y_of("1747").unwrap());
        // sorted top to bottom
        assert!(lines.windows(2).all(|w| w[0].bbox.y <= w[1].bbox.y + 1e-9));
    }
}
