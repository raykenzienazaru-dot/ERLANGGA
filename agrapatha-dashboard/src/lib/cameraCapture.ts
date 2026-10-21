/**
 * Camera Capture & Image Utility Service
 * Provides lifecycle-safe browser MediaDevices stream handling and offscreen frame capture.
 */

export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function isGetUserMediaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export function isSecureContextSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export class CameraAccessError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CameraAccessError';
    this.code = code;
  }
}

/**
 * Requests video stream from client's camera.
 * Never requests audio/microphone.
 */
export async function startCameraStream(
  constraints: MediaStreamConstraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  }
): Promise<MediaStream> {
  if (!isGetUserMediaSupported()) {
    throw new CameraAccessError(
      'Browser Anda tidak mendukung Web API MediaDevices (getUserMedia). Silakan gunakan opsi Unggah Foto.',
      'UNSUPPORTED'
    );
  }

  if (!isSecureContextSupported()) {
    throw new CameraAccessError(
      'Akses kamera browser memerlukan koneksi aman (HTTPS atau localhost). Gunakan opsi Unggah Foto jika membuka melalui HTTP.',
      'INSECURE_CONTEXT'
    );
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (err: unknown) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new CameraAccessError(
          'Izin akses kamera ditolak. Harap izinkan akses kamera di bilah alamat browser Anda.',
          'PERMISSION_DENIED'
        );
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new CameraAccessError(
          'Perangkat kamera tidak ditemukan pada sistem ini. Silakan gunakan opsi Unggah Foto.',
          'NOT_FOUND'
        );
      }
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new CameraAccessError(
          'Kamera tidak dapat diakses (sedang digunakan oleh aplikasi lain atau kendala perangkat keras).',
          'NOT_READABLE'
        );
      }
      if (err.name === 'OverconstrainedError') {
        // Fallback with minimal constraints
        try {
          return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          throw new CameraAccessError(
            'Kamera tidak mendukung konfigurasi resolusi yang diminta.',
            'OVERCONSTRAINED'
          );
        }
      }
    }
    const message = err instanceof Error ? err.message : 'Gagal membuka kamera.';
    throw new CameraAccessError(`Kendala kamera: ${message}`, 'UNKNOWN');
  }
}

/**
 * Safely stops all active tracks of a MediaStream.
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  try {
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.stop();
    }
  } catch {
    // Ignore cleanup exceptions on already stopped streams
  }
}

/**
 * Captures the current frame from an HTMLVideoElement and encodes as a JPEG Blob.
 */
export async function captureFrameFromVideo(videoEl: HTMLVideoElement): Promise<Blob> {
  const width = videoEl.videoWidth;
  const height = videoEl.videoHeight;

  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error('Dimensi video frame tidak valid atau kamera belum siap.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menginisialisasi 2D Canvas context untuk capture frame.');
  }

  ctx.drawImage(videoEl, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Gagal mengonversi frame kamera ke format JPEG Blob.'));
        }
      },
      'image/jpeg',
      0.92
    );
  });
}

/**
 * Validates an uploaded file for image MIME type and file size.
 */
export function validateImageFile(
  file: File,
  maxSizeBytes: number = MAX_IMAGE_FILE_SIZE_BYTES
): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'File tidak ditemukan.' };
  }

  if (!file.type || !file.type.startsWith('image/')) {
    return {
      valid: false,
      error: `Format file (${file.type || 'unknown'}) tidak didukung. Harap pilih gambar JPEG, PNG, atau WebP.`,
    };
  }

  if (file.size > maxSizeBytes) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `Ukuran file (${sizeMb} MB) melebihi batas maksimal ${maxMb} MB.`,
    };
  }

  return { valid: true };
}
