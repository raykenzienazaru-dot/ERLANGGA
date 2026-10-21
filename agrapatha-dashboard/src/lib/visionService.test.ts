import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureFrameFromVideo, stopMediaStream, validateImageFile } from './cameraCapture.ts';
import { getWildfireApiBaseUrl, isValidWildfireData } from './wildfireService.ts';
import {
  getLeafDiseaseApiBaseUrl,
  isLeafDiseaseApiConfigured,
  normalizeLeafClass,
  parseLeafPredictionData,
  predictLeafDiseaseImage,
} from './leafDiseaseService.ts';

describe('Vision & Camera Subsystem Unit Tests', () => {
  // 1. Image Validation Tests
  it('1. validateImageFile accepts valid JPEG/PNG files within 10MB', () => {
    const validFile = new File([new Uint8Array(1024)], 'canopy.jpg', { type: 'image/jpeg' });
    const result = validateImageFile(validFile);
    assert.equal(result.valid, true);
    assert.equal(result.error, undefined);
  });

  it('2. validateImageFile rejects non-image files', () => {
    const textFile = new File(['hello'], 'document.pdf', { type: 'application/pdf' });
    const result = validateImageFile(textFile);
    assert.equal(result.valid, false);
    assert.match(result.error || '', /tidak didukung/);
  });

  it('3. validateImageFile rejects files larger than 10MB limit', () => {
    const largeBlob = new Uint8Array(11 * 1024 * 1024);
    const largeFile = new File([largeBlob], 'huge.png', { type: 'image/png' });
    const result = validateImageFile(largeFile);
    assert.equal(result.valid, false);
    assert.match(result.error || '', /melebihi batas maksimal/);
  });

  // 2. Wildfire Configuration & Contract Tests
  it('4. getWildfireApiBaseUrl defaults to verified Railway production URL', () => {
    const url = getWildfireApiBaseUrl();
    assert.equal(url, 'https://tes-tflite-production.up.railway.app');
  });

  it('5. isValidWildfireData validates true wildfire payload', () => {
    const validPayload = {
      predicted_label: 'Fire',
      confidence: 0.94,
      confidence_percentage: 94.0,
      scores: { 'Non-Fire': 0.02, Smoke: 0.04, Fire: 0.94 },
      sorted_scores: [
        { class_name: 'Fire', score: 0.94, percentage: 94.0 },
        { class_name: 'Smoke', score: 0.04, percentage: 4.0 },
        { class_name: 'Non-Fire', score: 0.02, percentage: 2.0 },
      ],
      output_type: 'probabilities',
      inference_time_ms: 12.5,
      input_resolution: [224, 224],
      model_name: 'agrapatha_vision_mobilenetv2.tflite',
      timestamp: '2026-10-21T00:00:00Z',
    };
    assert.equal(isValidWildfireData(validPayload), true);
  });

  it('6. isValidWildfireData rejects leaf classes or invalid labels', () => {
    const leafPayloadInWildfire = {
      predicted_label: 'Healthy',
      confidence: 0.9,
      confidence_percentage: 90,
      scores: { Healthy: 0.9 },
    };
    assert.equal(isValidWildfireData(leafPayloadInWildfire), false);
  });

  // 3. Leaf Disease Class Normalization & Mapping Tests
  it('7. normalizeLeafClass maps raw candidate classes to verified frontend labels', () => {
    assert.equal(normalizeLeafClass('Healthy'), 'Healthy');
    assert.equal(normalizeLeafClass('Powdery'), 'Powdery Mildew');
    assert.equal(normalizeLeafClass('Powdery Mildew'), 'Powdery Mildew');
    assert.equal(normalizeLeafClass('Rust'), 'Leaf Rust');
    assert.equal(normalizeLeafClass('Leaf Rust'), 'Leaf Rust');
  });

  it('8. normalizeLeafClass strictly isolates against wildfire or invalid classes', () => {
    assert.equal(normalizeLeafClass('Fire'), null);
    assert.equal(normalizeLeafClass('Smoke'), null);
    assert.equal(normalizeLeafClass('Non-Fire'), null);
    assert.equal(normalizeLeafClass('Slug'), null);
    assert.equal(normalizeLeafClass('Spot'), null);
    assert.equal(normalizeLeafClass(''), null);
    assert.equal(normalizeLeafClass(123), null);
    assert.equal(normalizeLeafClass(null), null);
  });

  // 4. Leaf Disease Response Parsing Tests
  it('9. parseLeafPredictionData correctly normalizes candidate model output', () => {
    const rawCandidateOutput = {
      predicted_label: 'Powdery',
      confidence: 0.88,
      confidence_percentage: 88.0,
      scores: {
        Healthy: 0.05,
        Powdery: 0.88,
        Rust: 0.07,
      },
      sorted_scores: [
        { class_name: 'Powdery', score: 0.88, percentage: 88.0 },
        { class_name: 'Rust', score: 0.07, percentage: 7.0 },
        { class_name: 'Healthy', score: 0.05, percentage: 5.0 },
      ],
      inference_time_ms: 18.2,
      model_name: 'plant_model_3Classes.tflite',
      timestamp: '2026-10-21T01:00:00Z',
    };

    const parsed = parseLeafPredictionData(rawCandidateOutput);
    assert.ok(parsed);
    assert.equal(parsed.predicted_label, 'Powdery Mildew');
    assert.equal(parsed.confidence, 0.88);
    assert.equal(parsed.confidence_percentage, 88.0);
    assert.equal(parsed.scores['Powdery Mildew'], 0.88);
    assert.equal(parsed.scores['Leaf Rust'], 0.07);
    assert.equal(parsed.scores.Healthy, 0.05);
    assert.equal(parsed.sorted_scores[0].class_name, 'Powdery Mildew');
    assert.equal(parsed.sorted_scores[1].class_name, 'Leaf Rust');
    assert.equal(parsed.sorted_scores[2].class_name, 'Healthy');
  });

  it('10. parseLeafPredictionData rejects malformed, out-of-range, or missing data', () => {
    assert.equal(parseLeafPredictionData(null), null);
    assert.equal(parseLeafPredictionData({}), null);
    // Invalid class
    assert.equal(
      parseLeafPredictionData({
        predicted_label: 'UnknownDisease',
        confidence: 0.5,
      }),
      null
    );
    // Out-of-bounds confidence
    assert.equal(
      parseLeafPredictionData({
        predicted_label: 'Healthy',
        confidence: 1.5,
      }),
      null
    );
    // Negative confidence
    assert.equal(
      parseLeafPredictionData({
        predicted_label: 'Healthy',
        confidence: -0.2,
      }),
      null
    );
  });

  // 5. Unconfigured Service & Network Isolation Tests
  it('11. Leaf disease service reports unconfigured when VITE_LEAF_API_BASE_URL is not set', async () => {
    assert.equal(isLeafDiseaseApiConfigured(), false);
    assert.equal(getLeafDiseaseApiBaseUrl(), null);

    const dummyBlob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const res = await predictLeafDiseaseImage(dummyBlob);

    assert.equal(res.success, false);
    assert.equal(res.data, null);
    assert.match(res.error || '', /belum dikonfigurasi/);
  });

  // 6. Camera Lifecycle & Dimension Verification Tests
  it('12. captureFrameFromVideo rejects when video dimensions are zero or unready', async () => {
    const unreadyVideo = { videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    await assert.rejects(
      async () => {
        await captureFrameFromVideo(unreadyVideo);
      },
      /Dimensi video frame tidak valid/
    );
  });

  it('13. stopMediaStream cleanly stops all stream tracks', () => {
    let stoppedCount = 0;
    const fakeStream = {
      getTracks: () => [
        { stop: () => { stoppedCount++; } },
        { stop: () => { stoppedCount++; } },
      ],
    } as unknown as MediaStream;

    stopMediaStream(fakeStream);
    assert.equal(stoppedCount, 2);

    // Calling with null or undefined should not throw
    stopMediaStream(null);
  });
});
