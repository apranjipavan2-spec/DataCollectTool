"""
Server-side image compression for FieldGovern.

Compresses photos to an optimal size for field data collection:
  - Max resolution: 1920px on longest side (enough for detail, small file)
  - JPEG quality: 75 (good balance of quality vs size)
  - Strips EXIF metadata (except orientation)
  - Target: < 200KB per photo for fast 2G sync

This runs BEFORE uploading to Google Drive, so Drive stores
the already-optimized version.
"""
import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Config
MAX_DIMENSION = 1920  # px on longest side
JPEG_QUALITY = 75
MAX_TARGET_BYTES = 300_000  # 300KB soft target


def compress_image(
    content: bytes,
    mime_type: str = "image/jpeg",
    max_dimension: int = MAX_DIMENSION,
    quality: int = JPEG_QUALITY,
) -> tuple[bytes, str]:
    """Compress an image to optimal size.

    Args:
        content: Raw image bytes
        mime_type: Original MIME type
        max_dimension: Max px on longest side
        quality: JPEG quality (1-100)

    Returns:
        (compressed_bytes, output_mime_type)
    """
    original_size = len(content)

    try:
        img = Image.open(io.BytesIO(content))
    except Exception as e:
        logger.warning(f"Cannot open image for compression: {e}")
        return content, mime_type  # Return original if we can't process

    # Auto-orient based on EXIF (handles rotated phone photos)
    img = ImageOps.exif_transpose(img)

    # Convert to RGB if needed (handles RGBA PNGs, palette images, etc.)
    if img.mode in ("RGBA", "LA", "P"):
        # Create white background for transparency
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize if larger than max dimension
    w, h = img.size
    if max(w, h) > max_dimension:
        ratio = max_dimension / max(w, h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        logger.info(f"Resized image: {w}x{h} -> {new_w}x{new_h}")

    # Compress to JPEG
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=quality, optimize=True)
    compressed = buffer.getvalue()

    # If still too large, reduce quality progressively
    current_quality = quality
    while len(compressed) > MAX_TARGET_BYTES and current_quality > 40:
        current_quality -= 10
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=current_quality, optimize=True)
        compressed = buffer.getvalue()

    compressed_size = len(compressed)
    reduction = ((original_size - compressed_size) / original_size * 100) if original_size > 0 else 0
    logger.info(
        f"Image compressed: {original_size / 1024:.0f}KB -> {compressed_size / 1024:.0f}KB "
        f"({reduction:.0f}% reduction, q={current_quality})"
    )

    return compressed, "image/jpeg"
