import { scoreModelHazard } from './modelHazardRaw.ts';

// ============================================================================
// 1. MODEL 1: model_hazard.h (100-Tree Random Forest Classifier via m2cgen)
//    Features: [temp, RH, wind, rain, FFMC, DMC]
//    Classes : ['High', 'Low', 'Moderate'] (Alphabetical LabelEncoder order)
// ============================================================================

export interface HazardInferenceResult {
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  confidence: number; // 0 - 100
  highProbability: number; // 0 - 100
  moderateProbability: number; // 0 - 100
  lowProbability: number; // 0 - 100
  rawVector: [number, number, number]; // [P(High), P(Low), P(Moderate)]
  inputVector: [number, number, number, number, number, number]; // [temp, RH, wind, rain, FFMC, DMC]
  fwiIndices: {
    ffmc: number;
    dmc: number;
    dc: number;
    isi: number;
  };
  kaggleBinaryPrediction: 'On Fire' | 'safe';
}

export type ModelHazardResult = HazardInferenceResult;

export interface FloraSensorModelResult {
  sensorRisk: 'High' | 'Low' | 'Moderate';
  sensorConfidence: number;
  highProbability: number;
  lowProbability: number;
  moderateProbability: number;
}

/**
 * Computes approximate Canadian Forest Fire Weather Index (FWI) components
 * when not explicitly overridden, calibrated to Montesinho forestfires.csv ranges:
 * - FFMC: 18.7 – 96.2 (mean 90.64)
 * - DMC : 1.1 – 291.3 (mean 110.87)
 * - DC  : 7.9 – 860.6 (mean 547.94)
 * - ISI : 0.0 – 56.1  (mean 9.02)
 */
export function computeFwiComponents(params: {
  temp: number;
  rh: number;
  wind: number;
  rain: number;
  soilMoisture?: number;
  ffmcOverride?: number;
  dmcOverride?: number;
  dcOverride?: number;
  isiOverride?: number;
}) {
  const { temp, rh, wind, rain, soilMoisture = 50 } = params;

  const computedFfmc =
    params.ffmcOverride !== undefined
      ? params.ffmcOverride
      : Number(
          Math.min(
            96.2,
            Math.max(
              18.7,
              84.5 + (temp - 18.89) * 0.62 - (rh - 44.29) * 0.22 - rain * 6.5 + (wind - 4.02) * 0.35
            )
          ).toFixed(1)
        );

  const computedDmc =
    params.dmcOverride !== undefined
      ? params.dmcOverride
      : Number(
          Math.min(
            291.3,
            Math.max(
              1.1,
              110.87 + (temp - 18.89) * 4.8 - (rh - 44.29) * 1.35 - (soilMoisture - 50) * 1.4 - rain * 18.0
            )
          ).toFixed(1)
        );

  const computedDc =
    params.dcOverride !== undefined
      ? params.dcOverride
      : Number(
          Math.min(
            860.6,
            Math.max(7.9, 547.94 + (computedDmc - 110.87) * 2.65 + (temp - 18.89) * 6.2 - rain * 25.0)
          ).toFixed(1)
        );

  // Empirical ISI relationship from FFMC and Wind in FWI system
  const computedIsi =
    params.isiOverride !== undefined
      ? params.isiOverride
      : Number(
          Math.min(
            56.1,
            Math.max(
              0.0,
              computedFfmc < 75
                ? 0.8 + wind * 0.18
                : ((computedFfmc - 70) / 26.2) * (4.5 + wind * 1.35)
            )
          ).toFixed(1)
        );

  return {
    ffmc: computedFfmc,
    dmc: computedDmc,
    dc: computedDc,
    isi: computedIsi,
  };
}

/**
 * Executes the exact 100-tree C Random Forest model from `model_hazard.h`
 * Signature in C: `void score(double * input, double * output)`
 * Feature order: `[temp, RH, wind, rain, FFMC, DMC]`
 */
export function evaluateModelHazard(params?: {
  temp?: number | null;
  rh?: number | null;
  wind?: number | null;
  rain?: number | null;
  ffmc?: number | null;
  dmc?: number | null;
  dc?: number | null;
  isi?: number | null;
}): HazardInferenceResult | null {
  if (!params) return null;
  const { temp, rh, wind, rain, ffmc, dmc } = params;
  if (
    typeof temp !== 'number' || !Number.isFinite(temp) ||
    typeof rh !== 'number' || !Number.isFinite(rh) ||
    typeof wind !== 'number' || !Number.isFinite(wind) ||
    typeof rain !== 'number' || !Number.isFinite(rain) ||
    typeof ffmc !== 'number' || !Number.isFinite(ffmc) ||
    typeof dmc !== 'number' || !Number.isFinite(dmc)
  ) {
    return null;
  }

  const inputVector: [number, number, number, number, number, number] = [
    temp,
    rh,
    wind,
    rain,
    ffmc,
    dmc,
  ];

  const raw = scoreModelHazard(inputVector);
  // Alphabetical class order in model_hazard.h:
  // raw[0] = High, raw[1] = Low, raw[2] = Moderate
  const highProb = Number((raw[0] * 100).toFixed(2));
  const lowProb = Number((raw[1] * 100).toFixed(2));
  const modProb = Number((raw[2] * 100).toFixed(2));

  let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  let confidence = lowProb;

  if (highProb >= modProb && highProb >= lowProb) {
    riskLevel = 'HIGH';
    confidence = highProb;
  } else if (modProb >= highProb && modProb >= lowProb) {
    riskLevel = 'MODERATE';
    confidence = modProb;
  } else {
    riskLevel = 'LOW';
    confidence = lowProb;
  }

  const fwi = computeFwiComponents({
    temp,
    rh,
    wind,
    rain,
    ffmcOverride: ffmc,
    dmcOverride: dmc,
    dcOverride: typeof params.dc === 'number' && Number.isFinite(params.dc) ? params.dc : undefined,
    isiOverride: typeof params.isi === 'number' && Number.isFinite(params.isi) ? params.isi : undefined,
  });

  // Binary classification label matching Kaggle notebook (0: 'safe', 1: 'On Fire')
  const kaggleBinaryPrediction: 'On Fire' | 'safe' =
    riskLevel === 'HIGH' || (ffmc >= 89.5 && dmc >= 90) ? 'On Fire' : 'safe';

  return {
    riskLevel,
    confidence,
    highProbability: highProb,
    moderateProbability: modProb,
    lowProbability: lowProb,
    rawVector: raw,
    inputVector,
    fwiIndices: fwi,
    kaggleBinaryPrediction,
  };
}

// ============================================================================
// 2. MODEL 2: grenvis_sensor_model.h (FLORA Environmental Risk Neural Network)
//    Trained on Kaggle: raykenzie/flora-environmental-risk-dataset (9,000 rows)
//    Features: [temperature_c, humidity_percent, soil_moisture_percent]
//    Classes : ['High', 'Low', 'Moderate']
// ============================================================================

export const FLORA_SENSOR_MODEL_CONFIG = {
  classes: ['High', 'Low', 'Moderate'] as const,
  scaler: {
    mean: [28.62221905, 59.83464446, 67.15121274],
    std: [4.90833472, 14.30678582, 17.56037094],
  },
  weights: {
    w1: [
      [0.06882256269454956, -0.4267715513706207, -0.737812876701355],
      [-0.8693224787712097, -0.7673643827438354, 0.9594364762306213],
      [1.0567576885223389, 1.106550693511963, 0.018498126417398453],
      [-0.14441879093647003, 0.00937872938811779, -0.167218416929245],
      [-0.8071327209472656, -0.07039181143045425, -0.8527116179466248],
      [0.833522617816925, -0.004474660847336054, -0.870482861995697],
      [1.2302871942520142, -0.04089164733886719, -0.11043281108140945],
      [0.4346289038658142, -0.5216134190559387, 0.4670726954936981],
      [-0.3797735273838043, 0.44210222363471985, -0.466645747423172],
      [0.3798741400241852, 0.8371866345405579, 0.931255042552948],
      [0.27597203850746155, -1.0527435541152954, -1.10983407497406],
      [0.028266865760087967, 0.3196512460708618, -0.24809375405311584],
      [0.8012734055519104, -0.8134379982948303, 0.044027362018823624],
      [-0.8783088326454163, -0.028593210503458977, -1.149275541305542],
      [-0.015918029472231865, 1.098854899406433, -1.223756194114685],
      [-0.9087123274803162, 0.7294166684150696, 0.6827735900878906],
    ],
    b1: [
      -0.33383816480636597, -0.04227512702345848, 0.00598018616437912, 0.9734883308410645,
      0.0101948706433177, 0.08699293434619904, 0.15194343030452728, -0.039835698902606964,
      -0.1792176514863968, -0.1527959257364273, 0.050946008414030075, 1.1363394260406494,
      0.032514918595552444, 0.16508275270462036, 0.08269620686769485, -0.1381007581949234,
    ],
    w2: [
      [-0.08528643846511841, 0.9258883595466614, 0.9372411966323853, -0.2972812354564667, 0.28391730785369873, 0.6539251804351807, -0.45965415239334106, 0.39327797293663025, 0.7302142977714539, 0.6038991212844849, 0.27909255027770996, -0.6000090837478638, 0.8755719065666199, 0.27866849303245544, 0.4186272919178009, 0.5126122236251831],
      [0.38313302397727966, -0.2798565924167633, -0.6670504212379456, 0.7949616312980652, -0.5273675322532654, -0.2648628056049347, 0.8802730441093445, -0.4845865070819855, 0.02055532857775688, -0.3929181396961212, -0.2888396978378296, 1.393118977546692, -0.15848633646965027, -0.014853849075734615, -0.5457460284233093, -0.33138036727905273],
      [0.4096508324146271, 0.6907843351364136, 0.5744191408157349, -0.4921860992908478, 0.21714578568935394, 0.2794820964336395, 0.5689708590507507, 0.11954770237207413, -0.24762453138828278, 1.1214158535003662, 0.8481930494308472, -0.5134627819061279, 0.46792274713516235, 1.0409159660339355, 0.690727710723877, 1.0592621564865112],
      [0.6716789603233337, -0.433378666639328, -0.3417074680328369, 1.1884747743606567, -0.6467021107673645, -1.3498767614364624, 1.0179617404937744, -0.6889092326164246, -0.49025285243988037, -1.0054714679718018, -0.13654395937919617, 1.2754573822021484, -0.7012107372283936, -0.38324686884880066, -0.19201244413852692, -0.1864306926727295],
      [0.3110116124153137, 0.6469503045082092, 0.656973123550415, -0.42947953939437866, 1.0382357835769653, 0.7639718055725098, 0.09721807390451431, 0.9110994935035706, 0.3641708791255951, 0.7807572484016418, 1.0385931730270386, -0.6630306839942932, 0.9146028757095337, 0.6162042021751404, 1.0718811750411987, 1.0075286626815796],
      [-1.461543083190918, 0.7269726395606995, -0.40606456995010376, -0.08050477504730225, -0.5667373538017273, 0.1318613588809967, 0.591193675994873, 0.055499445647001266, 0.07901997119188309, -0.9624040722846985, -0.7183491587638855, -0.02602144330739975, -0.047028105705976486, 0.35150280594825745, 0.912333071231842, -0.6064872145652771],
      [-0.7923133373260498, 0.1591053456068039, 0.8603146076202393, -0.12581093609333038, 0.777137815952301, 0.3313423991203308, -0.10066390782594681, 0.38185828924179077, 0.3132287561893463, -0.3796441853046417, 0.3952942192554474, -0.6672437191009521, 0.29572203755378723, -0.173675075173378, 0.556067943572998, 0.5922378301620483],
      [0.08922634273767471, 0.893825888633728, 0.5647271871566772, -0.331464946269989, 0.1557532101869583, 0.5404926538467407, -0.03166302293539047, 0.49496689438819885, 0.9643188118934631, 0.5456828474998474, 0.10235010832548141, -0.50180584192276, 0.7161643505096436, 0.4410538375377655, -0.008739474229514599, 0.31059911847114563],
    ],
    b2: [
      -0.4448825716972351, 1.08997642993927, -0.07677268236875534, 1.2537405490875244,
      -0.4421117603778839, 0.11290084570646286, -0.42201805114746094, -0.41561034321784973,
    ],
    w3: [
      [1.6813514232635498, -1.5571410655975342, 0.32658571004867554, -2.547600746154785, 0.9485321640968323, -2.1808338165283203, 1.1100209951400757, 1.5548009872436523],
      [-1.6825470924377441, 1.2517266273498535, -1.506621241569519, 1.286407470703125, -1.9308793544769287, 0.43764057755470276, -0.5190735459327698, -2.007999897003174],
      [-0.14856992661952972, 0.2482733279466629, 1.1309523582458496, -0.5288796424865723, 0.34089553356170654, 1.4595993757247925, -1.7829900979995728, -0.24722546339035034],
    ],
    b3: [-0.6362723112106323, 0.5786270499229431, 0.16296890377998352],
  },
};

function denseLayer(input: number[], weights: number[][], bias: number[]): number[] {
  const out = new Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    let sum = bias[i];
    const row = weights[i];
    for (let j = 0; j < input.length; j++) {
      sum += input[j] * row[j];
    }
    out[i] = sum;
  }
  return out;
}

function relu(vec: number[]): number[] {
  return vec.map((v) => Math.max(0, v));
}

function softmax(vec: number[]): number[] {
  const maxVal = Math.max(...vec);
  const exps = vec.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / (sum || 1));
}

export function evaluateFloraSensorModel(
  tempC?: number | null,
  humidityPct?: number | null,
  soilMoisturePct?: number | null
): FloraSensorModelResult | null {
  if (
    typeof tempC !== 'number' || !Number.isFinite(tempC) ||
    typeof humidityPct !== 'number' || !Number.isFinite(humidityPct) ||
    typeof soilMoisturePct !== 'number' || !Number.isFinite(soilMoisturePct)
  ) {
    return null;
  }

  const { mean, std } = FLORA_SENSOR_MODEL_CONFIG.scaler;
  const { w1, b1, w2, b2, w3, b3 } = FLORA_SENSOR_MODEL_CONFIG.weights;

  const x0 = (tempC - mean[0]) / std[0];
  const x1 = (humidityPct - mean[1]) / std[1];
  const x2 = (soilMoisturePct - mean[2]) / std[2];

  const h1 = relu(denseLayer([x0, x1, x2], w1, b1));
  const h2 = relu(denseLayer(h1, w2, b2));
  const logits = denseLayer(h2, w3, b3);
  const probs = softmax(logits);

  const highProb = Number((probs[0] * 100).toFixed(2));
  const lowProb = Number((probs[1] * 100).toFixed(2));
  const modProb = Number((probs[2] * 100).toFixed(2));

  let maxIdx = 0;
  if (probs[1] > probs[maxIdx]) maxIdx = 1;
  if (probs[2] > probs[maxIdx]) maxIdx = 2;

  return {
    sensorRisk: FLORA_SENSOR_MODEL_CONFIG.classes[maxIdx], // 'High' | 'Low' | 'Moderate'
    sensorConfidence: Number((probs[maxIdx] * 100).toFixed(2)),
    highProbability: highProb,
    lowProbability: lowProb,
    moderateProbability: modProb,
  };
}

// ============================================================================
// 3. EXACT KAGGLE DATASET BENCHMARKS & METADATA
//    1) https://www.kaggle.com/code/e96031413/forest-fire-area-classification
//    2) https://www.kaggle.com/datasets/raykenzie/flora-environmental-risk-dataset
// ============================================================================

export const KAGGLE_FOREST_FIRE_STATS = {
  datasetTitle: 'Forest Fires Data Set (Montesinho Natural Park, Portugal)',
  notebookUrl: 'https://www.kaggle.com/code/e96031413/forest-fire-area-classification',
  totalInstances: 517,
  trainSplit: 361, // 70%
  testSplit: 156,  // 30% (random_state=101, support: 69 safe, 87 On Fire)
  binaryDistribution: {
    safeCount: 247,   // area == 0 (47.78%)
    onFireCount: 270, // area > 0  (52.22%)
  },
  modelHazardDistribution: {
    highCount: 338,     // 65.38%
    moderateCount: 146, // 28.24%
    lowCount: 33,       // 6.38%
  },
  features: {
    temp: { min: 2.2, max: 33.3, mean: 18.89, std: 5.81, unit: '°C', label: 'Temperature (temp)' },
    RH: { min: 15.0, max: 100.0, mean: 44.29, std: 16.32, unit: '%', label: 'Relative Humidity (RH)' },
    wind: { min: 0.4, max: 9.4, mean: 4.02, std: 1.79, unit: 'km/h', label: 'Wind Speed (wind)' },
    rain: { min: 0.0, max: 6.4, mean: 0.02, std: 0.30, unit: 'mm/m²', label: 'Outside Rain (rain)' },
    FFMC: { min: 18.7, max: 96.2, mean: 90.64, std: 5.52, unit: 'idx', label: 'Fine Fuel Moisture (FFMC)' },
    DMC: { min: 1.1, max: 291.3, mean: 110.87, std: 64.05, unit: 'idx', label: 'Duff Moisture Code (DMC)' },
    DC: { min: 7.9, max: 860.6, mean: 547.94, std: 248.07, unit: 'idx', label: 'Drought Code (DC)' },
    ISI: { min: 0.0, max: 56.1, mean: 9.02, std: 4.56, unit: 'idx', label: 'Initial Spread Index (ISI)' },
    area: { min: 0.0, max: 1090.84, mean: 12.85, std: 63.66, unit: 'ha', label: 'Burned Area (area)' },
  },
  notebookTestVector: {
    raw: [1, 4, 9, 1, 91.5, 130.1, 807.1, 7.5, 21.3, 35, 2.2, 0],
    description: 'x_new = [[X=1, Y=4, month=sep(9), day=sun(1), FFMC=91.5, DMC=130.1, DC=807.1, ISI=7.5, temp=21.3, RH=35, wind=2.2, rain=0]]',
    temp: 21.3,
    rh: 35.0,
    wind: 2.2,
    rain: 0.0,
    ffmc: 91.5,
    dmc: 130.1,
    dc: 807.1,
    isi: 7.5,
    prediction: 'On Fire',
  },
  classifiersHoldout: [
    {
      name: 'KNN (Tuned k=19)',
      accuracy: 62.82,
      precision: 65.59,
      recall: 70.11,
      f1Weighted: 62.4,
      confusionMatrix: null,
      predictionOnXNew: 'On Fire',
    },
    {
      name: 'Support Vector Machine (SVC)',
      accuracy: 61.54,
      precision: 60.80,
      recall: 87.36,
      f1Weighted: 58.0,
      confusionMatrix: [
        [20, 49],
        [11, 76],
      ],
      predictionOnXNew: 'On Fire',
    },
    {
      name: 'KNN (Default k=5)',
      accuracy: 58.97,
      precision: 63.22,
      recall: 63.22,
      f1Weighted: 59.0,
      confusionMatrix: [
        [37, 32],
        [32, 55],
      ],
      predictionOnXNew: 'On Fire',
    },
    {
      name: 'Decision Tree (CART)',
      accuracy: 53.85,
      precision: 58.06,
      recall: 62.07,
      f1Weighted: 54.0,
      confusionMatrix: [
        [30, 39],
        [33, 54],
      ],
      predictionOnXNew: 'On Fire',
    },
    {
      name: 'Gaussian Naive Bayes',
      accuracy: 48.08,
      precision: 58.82,
      recall: 22.99,
      f1Weighted: 44.0,
      confusionMatrix: [
        [55, 14],
        [67, 20],
      ],
      predictionOnXNew: 'On Fire',
    },
  ],
  crossValidation10Fold: [
    { code: 'SVM', name: 'Support Vector Machine', meanAcc: 48.02, stdAcc: 23.41 },
    { code: 'KNN', name: 'K-Nearest Neighbors', meanAcc: 46.84, stdAcc: 14.06 },
    { code: 'MLP', name: 'Multi-Layer Perceptron', meanAcc: 44.14, stdAcc: 13.85 },
    { code: 'CART', name: 'Decision Tree Classifier', meanAcc: 43.73, stdAcc: 10.90 },
    { code: 'Bagging', name: 'Bagging Classifier', meanAcc: 42.98, stdAcc: 10.68 },
    { code: 'GradientBoost', name: 'Gradient Boosting', meanAcc: 42.79, stdAcc: 15.69 },
    { code: 'ExtraTrees', name: 'Extra Trees Ensemble', meanAcc: 40.86, stdAcc: 14.45 },
    { code: 'NB', name: 'Gaussian Naive Bayes', meanAcc: 39.75, stdAcc: 18.98 },
    { code: 'AdaBoost', name: 'AdaBoost Classifier', meanAcc: 39.69, stdAcc: 15.56 },
    { code: 'LR', name: 'Logistic Regression', meanAcc: 39.52, stdAcc: 15.15 },
    { code: 'RandomForest', name: 'Random Forest (100 Trees)', meanAcc: 39.11, stdAcc: 14.45 },
  ],
};

export const KAGGLE_FLORA_DATASET_STATS = {
  datasetTitle: 'FLORA Environmental Risk Dataset',
  datasetUrl: 'https://www.kaggle.com/datasets/raykenzie/flora-environmental-risk-dataset',
  totalSamples: 9000,
  classBalance: {
    Low: 3000,
    Moderate: 3000,
    High: 3000,
  },
  features: {
    temperature_c: { mean: 28.62, std: 4.91, unit: '°C', label: 'Ambient Temperature (DHT22)' },
    humidity_percent: { mean: 59.83, std: 14.31, unit: '%', label: 'Relative Humidity (DHT22)' },
    soil_moisture_percent: { mean: 67.15, std: 17.56, unit: '%', label: 'Soil Moisture (Capacitive)' },
  },
};
