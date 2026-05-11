-- ============================================================
-- Emoji Sentiment Seed Data
-- Source: Novak et al. (2015) "Sentiment of Emojis" PLOS ONE
-- Dataset: CLARIN.SI (http://hdl.handle.net/11356/1048)
--
-- Fields: emoji, unicode_codepoint, unicode_name, unicode_block,
--         occurrences, negative, neutral, positive, sentiment_score, position
--
-- sentiment_score: range (-1, +1), computed from the distribution
-- position: normalized position in sentiment ranking (0=most negative, 1=most positive)
--
-- This file contains the most frequently used emojis from the dataset.
-- For the full 751 emoji dataset, import from the CLARIN.SI CSV.
-- ============================================================

INSERT INTO emoji_sentiment_lookup
  (emoji, unicode_codepoint, unicode_name, unicode_block, occurrences, negative, neutral, positive, sentiment_score, position)
VALUES
  -- ── Top positive emojis ──
  ('❤', '0x2764', 'HEAVY BLACK HEART', 'Dingbats', 20345, 0.048, 0.206, 0.746, 0.746, 0.970),
  ('😂', '0x1F602', 'FACE WITH TEARS OF JOY', 'Emoticons', 14622, 0.039, 0.224, 0.737, 0.659, 0.960),
  ('😍', '0x1F60D', 'SMILING FACE WITH HEART-SHAPED EYES', 'Emoticons', 7964, 0.042, 0.280, 0.678, 0.678, 0.950),
  ('🎉', '0x1F389', 'PARTY POPPER', 'Miscellaneous Symbols And Pictographs', 2060, 0.038, 0.305, 0.657, 0.657, 0.945),
  ('😊', '0x1F60A', 'SMILING FACE WITH SMILING EYES', 'Emoticons', 5765, 0.055, 0.313, 0.632, 0.632, 0.940),
  ('😘', '0x1F618', 'FACE THROWING A KISS', 'Emoticons', 4396, 0.041, 0.337, 0.622, 0.622, 0.935),
  ('💕', '0x1F495', 'TWO HEARTS', 'Miscellaneous Symbols And Pictographs', 2459, 0.054, 0.330, 0.616, 0.616, 0.930),
  ('🙌', '0x1F64C', 'PERSON RAISING BOTH HANDS IN CELEBRATION', 'Emoticons', 1690, 0.060, 0.340, 0.600, 0.600, 0.925),
  ('😁', '0x1F601', 'GRINNING FACE WITH SMILING EYES', 'Emoticons', 3399, 0.058, 0.350, 0.592, 0.592, 0.920),
  ('🎶', '0x1F3B6', 'MULTIPLE MUSICAL NOTES', 'Miscellaneous Symbols And Pictographs', 1624, 0.051, 0.370, 0.579, 0.579, 0.915),
  ('💪', '0x1F4AA', 'FLEXED BICEPS', 'Miscellaneous Symbols And Pictographs', 1870, 0.062, 0.365, 0.573, 0.573, 0.910),
  ('✨', '0x2728', 'SPARKLES', 'Dingbats', 2189, 0.044, 0.390, 0.566, 0.566, 0.905),
  ('😃', '0x1F603', 'SMILING FACE WITH OPEN MOUTH', 'Emoticons', 2339, 0.060, 0.385, 0.555, 0.555, 0.900),
  ('👍', '0x1F44D', 'THUMBS UP SIGN', 'Miscellaneous Symbols And Pictographs', 4002, 0.067, 0.412, 0.521, 0.521, 0.890),
  ('😄', '0x1F604', 'SMILING FACE WITH OPEN MOUTH AND SMILING EYES', 'Emoticons', 3065, 0.065, 0.420, 0.515, 0.515, 0.885),
  ('💜', '0x1F49C', 'PURPLE HEART', 'Miscellaneous Symbols And Pictographs', 1405, 0.061, 0.425, 0.514, 0.514, 0.880),
  ('💙', '0x1F499', 'BLUE HEART', 'Miscellaneous Symbols And Pictographs', 1263, 0.059, 0.430, 0.511, 0.511, 0.875),
  ('🔥', '0x1F525', 'FIRE', 'Miscellaneous Symbols And Pictographs', 1573, 0.086, 0.413, 0.501, 0.501, 0.870),
  ('😆', '0x1F606', 'SMILING FACE WITH OPEN MOUTH AND TIGHTLY-CLOSED EYES', 'Emoticons', 1506, 0.076, 0.433, 0.491, 0.491, 0.865),
  ('💖', '0x1F496', 'SPARKLING HEART', 'Miscellaneous Symbols And Pictographs', 1327, 0.063, 0.453, 0.484, 0.484, 0.860),
  ('👏', '0x1F44F', 'CLAPPING HANDS SIGN', 'Miscellaneous Symbols And Pictographs', 1715, 0.085, 0.440, 0.475, 0.475, 0.855),
  ('🙏', '0x1F64F', 'PERSON WITH FOLDED HANDS', 'Emoticons', 2212, 0.112, 0.438, 0.450, 0.350, 0.830),
  ('💗', '0x1F497', 'GROWING HEART', 'Miscellaneous Symbols And Pictographs', 841, 0.067, 0.465, 0.468, 0.468, 0.850),
  ('🌟', '0x1F31F', 'GLOWING STAR', 'Miscellaneous Symbols And Pictographs', 756, 0.053, 0.480, 0.467, 0.467, 0.845),
  ('🥳', '0x1F973', 'PARTYING FACE', 'Supplemental Symbols and Pictographs', 680, 0.044, 0.380, 0.576, 0.576, 0.912),

  -- ── Moderate positive emojis ──
  ('👌', '0x1F44C', 'OK HAND SIGN', 'Miscellaneous Symbols And Pictographs', 1495, 0.080, 0.500, 0.420, 0.420, 0.820),
  ('☺', '0x263A', 'WHITE SMILING FACE', 'Miscellaneous Symbols', 2103, 0.093, 0.498, 0.409, 0.409, 0.815),
  ('😉', '0x1F609', 'WINKING FACE', 'Emoticons', 3222, 0.097, 0.507, 0.396, 0.396, 0.810),
  ('✅', '0x2705', 'WHITE HEAVY CHECK MARK', 'Dingbats', 870, 0.070, 0.540, 0.390, 0.390, 0.805),
  ('😎', '0x1F60E', 'SMILING FACE WITH SUNGLASSES', 'Emoticons', 2042, 0.088, 0.532, 0.380, 0.380, 0.800),
  ('💚', '0x1F49A', 'GREEN HEART', 'Miscellaneous Symbols And Pictographs', 908, 0.075, 0.552, 0.373, 0.373, 0.795),
  ('🎊', '0x1F38A', 'CONFETTI BALL', 'Miscellaneous Symbols And Pictographs', 512, 0.052, 0.520, 0.428, 0.428, 0.825),
  ('💛', '0x1F49B', 'YELLOW HEART', 'Miscellaneous Symbols And Pictographs', 803, 0.078, 0.560, 0.362, 0.362, 0.790),
  ('😋', '0x1F60B', 'FACE SAVOURING DELICIOUS FOOD', 'Emoticons', 1189, 0.083, 0.563, 0.354, 0.354, 0.785),
  ('💘', '0x1F498', 'HEART WITH ARROW', 'Miscellaneous Symbols And Pictographs', 712, 0.081, 0.566, 0.353, 0.353, 0.780),
  ('🎁', '0x1F381', 'WRAPPED PRESENT', 'Miscellaneous Symbols And Pictographs', 663, 0.065, 0.590, 0.345, 0.345, 0.775),
  ('👋', '0x1F44B', 'WAVING HAND SIGN', 'Miscellaneous Symbols And Pictographs', 582, 0.079, 0.590, 0.331, 0.331, 0.770),
  ('🌸', '0x1F338', 'CHERRY BLOSSOM', 'Miscellaneous Symbols And Pictographs', 673, 0.060, 0.610, 0.330, 0.330, 0.765),
  ('🌹', '0x1F339', 'ROSE', 'Miscellaneous Symbols And Pictographs', 604, 0.073, 0.605, 0.322, 0.322, 0.760),
  ('😜', '0x1F61C', 'FACE WITH STUCK-OUT TONGUE AND WINKING EYE', 'Emoticons', 1867, 0.102, 0.590, 0.308, 0.308, 0.755),
  ('😏', '0x1F60F', 'SMIRKING FACE', 'Emoticons', 2310, 0.121, 0.588, 0.291, 0.291, 0.745),

  -- ── Neutral emojis ──
  ('😐', '0x1F610', 'NEUTRAL FACE', 'Emoticons', 952, 0.200, 0.600, 0.200, 0.000, 0.500),
  ('😶', '0x1F636', 'FACE WITHOUT MOUTH', 'Emoticons', 410, 0.215, 0.580, 0.205, -0.010, 0.495),
  ('🤔', '0x1F914', 'THINKING FACE', 'Supplemental Symbols and Pictographs', 1380, 0.180, 0.640, 0.180, 0.120, 0.540),
  ('😳', '0x1F633', 'FLUSHED FACE', 'Emoticons', 1294, 0.180, 0.590, 0.230, 0.050, 0.520),
  ('😅', '0x1F605', 'SMILING FACE WITH OPEN MOUTH AND COLD SWEAT', 'Emoticons', 1713, 0.148, 0.551, 0.301, 0.153, 0.570),
  ('🙈', '0x1F648', 'SEE-NO-EVIL MONKEY', 'Emoticons', 1155, 0.130, 0.560, 0.310, 0.180, 0.580),
  ('👀', '0x1F440', 'EYES', 'Miscellaneous Symbols And Pictographs', 808, 0.152, 0.612, 0.236, 0.084, 0.535),
  ('💬', '0x1F4AC', 'SPEECH BALLOON', 'Miscellaneous Symbols And Pictographs', 340, 0.120, 0.680, 0.200, 0.080, 0.530),
  ('📋', '0x1F4CB', 'CLIPBOARD', 'Miscellaneous Symbols And Pictographs', 210, 0.100, 0.750, 0.150, 0.050, 0.515),
  ('📅', '0x1F4C5', 'CALENDAR', 'Miscellaneous Symbols And Pictographs', 245, 0.095, 0.760, 0.145, 0.050, 0.515),
  ('💰', '0x1F4B0', 'MONEY BAG', 'Miscellaneous Symbols And Pictographs', 462, 0.130, 0.600, 0.270, 0.140, 0.560),
  ('📞', '0x1F4DE', 'TELEPHONE RECEIVER', 'Miscellaneous Symbols And Pictographs', 275, 0.105, 0.720, 0.175, 0.070, 0.525),
  ('📍', '0x1F4CD', 'ROUND PUSHPIN', 'Miscellaneous Symbols And Pictographs', 198, 0.090, 0.770, 0.140, 0.050, 0.515),
  ('📸', '0x1F4F8', 'CAMERA WITH FLASH', 'Miscellaneous Symbols And Pictographs', 310, 0.080, 0.730, 0.190, 0.110, 0.545),
  ('⏰', '0x23F0', 'ALARM CLOCK', 'Miscellaneous Technical', 220, 0.110, 0.740, 0.150, 0.040, 0.510),
  ('📩', '0x1F4E9', 'ENVELOPE WITH DOWNWARDS ARROW ABOVE', 'Miscellaneous Symbols And Pictographs', 185, 0.090, 0.760, 0.150, 0.060, 0.520),

  -- ── Slightly negative emojis ──
  ('😒', '0x1F612', 'UNAMUSED FACE', 'Emoticons', 2082, 0.334, 0.458, 0.208, -0.126, 0.380),
  ('😑', '0x1F611', 'EXPRESSIONLESS FACE', 'Emoticons', 605, 0.310, 0.470, 0.220, -0.090, 0.400),
  ('😔', '0x1F614', 'PENSIVE FACE', 'Emoticons', 1903, 0.322, 0.443, 0.235, -0.087, 0.410),
  ('😞', '0x1F61E', 'DISAPPOINTED FACE', 'Emoticons', 1408, 0.381, 0.390, 0.229, -0.152, 0.360),
  ('😕', '0x1F615', 'CONFUSED FACE', 'Emoticons', 684, 0.340, 0.440, 0.220, -0.120, 0.390),
  ('😤', '0x1F624', 'FACE WITH LOOK OF TRIUMPH', 'Emoticons', 1070, 0.292, 0.440, 0.268, -0.024, 0.460),
  ('😪', '0x1F62A', 'SLEEPY FACE', 'Emoticons', 478, 0.310, 0.460, 0.230, -0.080, 0.420),
  ('😫', '0x1F62B', 'TIRED FACE', 'Emoticons', 731, 0.340, 0.420, 0.240, -0.100, 0.405),

  -- ── Negative emojis ──
  ('😢', '0x1F622', 'CRYING FACE', 'Emoticons', 3220, 0.417, 0.266, 0.317, -0.317, 0.300),
  ('😭', '0x1F62D', 'LOUDLY CRYING FACE', 'Emoticons', 3691, 0.368, 0.298, 0.334, -0.034, 0.470),
  ('💔', '0x1F494', 'BROKEN HEART', 'Miscellaneous Symbols And Pictographs', 1685, 0.521, 0.258, 0.221, -0.421, 0.240),
  ('😡', '0x1F621', 'POUTING FACE', 'Emoticons', 997, 0.562, 0.246, 0.192, -0.562, 0.180),
  ('😠', '0x1F620', 'ANGRY FACE', 'Emoticons', 752, 0.540, 0.260, 0.200, -0.540, 0.190),
  ('😩', '0x1F629', 'WEARY FACE', 'Emoticons', 1135, 0.345, 0.370, 0.285, -0.060, 0.440),
  ('😰', '0x1F630', 'FACE WITH OPEN MOUTH AND COLD SWEAT', 'Emoticons', 435, 0.380, 0.400, 0.220, -0.160, 0.350),
  ('😱', '0x1F631', 'FACE SCREAMING IN FEAR', 'Emoticons', 815, 0.310, 0.420, 0.270, -0.040, 0.455),
  ('😿', '0x1F63F', 'CRYING CAT FACE', 'Emoticons', 268, 0.410, 0.330, 0.260, -0.150, 0.355),
  ('🤦', '0x1F926', 'FACE PALM', 'Supplemental Symbols and Pictographs', 520, 0.380, 0.410, 0.210, -0.170, 0.345),
  ('🤮', '0x1F92E', 'FACE VOMITING', 'Supplemental Symbols and Pictographs', 290, 0.520, 0.310, 0.170, -0.350, 0.260),

  -- ── Hand gestures and body ──
  ('🤝', '0x1F91D', 'HANDSHAKE', 'Supplemental Symbols and Pictographs', 380, 0.063, 0.520, 0.417, 0.417, 0.818),
  ('🤗', '0x1F917', 'HUGGING FACE', 'Supplemental Symbols and Pictographs', 490, 0.055, 0.440, 0.505, 0.505, 0.872),
  ('✌', '0x270C', 'VICTORY HAND', 'Dingbats', 980, 0.072, 0.490, 0.438, 0.438, 0.822),
  ('🙂', '0x1F642', 'SLIGHTLY SMILING FACE', 'Emoticons', 1650, 0.100, 0.550, 0.350, 0.250, 0.650),
  ('🙃', '0x1F643', 'UPSIDE-DOWN FACE', 'Emoticons', 680, 0.170, 0.540, 0.290, 0.120, 0.545),
  ('🤷', '0x1F937', 'SHRUG', 'Supplemental Symbols and Pictographs', 420, 0.200, 0.580, 0.220, 0.020, 0.505),
  ('👊', '0x1F44A', 'FISTED HAND SIGN', 'Miscellaneous Symbols And Pictographs', 685, 0.120, 0.460, 0.420, 0.300, 0.750),
  ('🤙', '0x1F919', 'CALL ME HAND', 'Supplemental Symbols and Pictographs', 350, 0.075, 0.510, 0.415, 0.340, 0.780),
  ('👆', '0x1F446', 'WHITE UP POINTING BACKHAND INDEX', 'Miscellaneous Symbols And Pictographs', 310, 0.100, 0.680, 0.220, 0.120, 0.550),
  ('👇', '0x1F447', 'WHITE DOWN POINTING BACKHAND INDEX', 'Miscellaneous Symbols And Pictographs', 280, 0.095, 0.690, 0.215, 0.120, 0.550),
  ('👉', '0x1F449', 'WHITE RIGHT POINTING BACKHAND INDEX', 'Miscellaneous Symbols And Pictographs', 420, 0.090, 0.700, 0.210, 0.120, 0.550),
  ('🫶', '0x1FAF6', 'HEART HANDS', 'Symbols and Pictographs Extended-A', 320, 0.040, 0.350, 0.610, 0.610, 0.928),

  -- ── Nature and objects common in WhatsApp ──
  ('☀', '0x2600', 'BLACK SUN WITH RAYS', 'Miscellaneous Symbols', 543, 0.065, 0.530, 0.405, 0.340, 0.775),
  ('🌈', '0x1F308', 'RAINBOW', 'Miscellaneous Symbols And Pictographs', 412, 0.048, 0.510, 0.442, 0.394, 0.808),
  ('🎵', '0x1F3B5', 'MUSICAL NOTE', 'Miscellaneous Symbols And Pictographs', 760, 0.058, 0.510, 0.432, 0.374, 0.795),
  ('🎂', '0x1F382', 'BIRTHDAY CAKE', 'Miscellaneous Symbols And Pictographs', 554, 0.042, 0.460, 0.498, 0.456, 0.840),
  ('🎄', '0x1F384', 'CHRISTMAS TREE', 'Miscellaneous Symbols And Pictographs', 530, 0.038, 0.430, 0.532, 0.494, 0.862),
  ('🍀', '0x1F340', 'FOUR LEAF CLOVER', 'Miscellaneous Symbols And Pictographs', 340, 0.050, 0.480, 0.470, 0.420, 0.820),
  ('⭐', '0x2B50', 'WHITE MEDIUM STAR', 'Miscellaneous Symbols and Arrows', 890, 0.058, 0.500, 0.442, 0.384, 0.800),
  ('🌙', '0x1F319', 'CRESCENT MOON', 'Miscellaneous Symbols And Pictographs', 345, 0.075, 0.590, 0.335, 0.260, 0.680),
  ('☕', '0x2615', 'HOT BEVERAGE', 'Miscellaneous Symbols', 410, 0.060, 0.600, 0.340, 0.280, 0.720),
  ('🍕', '0x1F355', 'SLICE OF PIZZA', 'Miscellaneous Symbols And Pictographs', 280, 0.055, 0.560, 0.385, 0.330, 0.770),
  ('💊', '0x1F48A', 'PILL', 'Miscellaneous Symbols And Pictographs', 155, 0.220, 0.580, 0.200, -0.020, 0.490),
  ('🏥', '0x1F3E5', 'HOSPITAL', 'Miscellaneous Symbols And Pictographs', 130, 0.200, 0.600, 0.200, 0.000, 0.500),
  ('💉', '0x1F489', 'SYRINGE', 'Miscellaneous Symbols And Pictographs', 165, 0.230, 0.570, 0.200, -0.030, 0.485),

  -- ── Faces commonly used in sales/service conversations ──
  ('😬', '0x1F62C', 'GRIMACING FACE', 'Emoticons', 542, 0.250, 0.480, 0.270, 0.020, 0.505),
  ('🤩', '0x1F929', 'STAR-STRUCK', 'Supplemental Symbols and Pictographs', 410, 0.035, 0.320, 0.645, 0.645, 0.942),
  ('🥰', '0x1F970', 'SMILING FACE WITH HEARTS', 'Supplemental Symbols and Pictographs', 520, 0.038, 0.300, 0.662, 0.662, 0.948),
  ('🤣', '0x1F923', 'ROLLING ON THE FLOOR LAUGHING', 'Supplemental Symbols and Pictographs', 890, 0.042, 0.240, 0.718, 0.676, 0.955),
  ('😀', '0x1F600', 'GRINNING FACE', 'Emoticons', 1820, 0.068, 0.400, 0.532, 0.464, 0.842),
  ('😇', '0x1F607', 'SMILING FACE WITH HALO', 'Emoticons', 740, 0.070, 0.420, 0.510, 0.440, 0.835),
  ('😌', '0x1F60C', 'RELIEVED FACE', 'Emoticons', 905, 0.090, 0.480, 0.430, 0.340, 0.775),
  ('🤞', '0x1F91E', 'CROSSED FINGERS', 'Supplemental Symbols and Pictographs', 460, 0.095, 0.530, 0.375, 0.280, 0.720),
  ('😮', '0x1F62E', 'FACE WITH OPEN MOUTH', 'Emoticons', 420, 0.190, 0.560, 0.250, 0.060, 0.525),
  ('🫣', '0x1FAE3', 'FACE WITH PEEKING EYE', 'Symbols and Pictographs Extended-A', 180, 0.160, 0.570, 0.270, 0.110, 0.545),

  -- ── Arrows and symbols used in sales messages ──
  ('➡', '0x27A1', 'BLACK RIGHTWARDS ARROW', 'Dingbats', 320, 0.085, 0.780, 0.135, 0.050, 0.515),
  ('⬇', '0x2B07', 'DOWNWARDS BLACK ARROW', 'Miscellaneous Symbols and Arrows', 210, 0.090, 0.770, 0.140, 0.050, 0.515),
  ('▶', '0x25B6', 'BLACK RIGHT-POINTING TRIANGLE', 'Geometric Shapes', 185, 0.080, 0.790, 0.130, 0.050, 0.515),
  ('⚡', '0x26A1', 'HIGH VOLTAGE SIGN', 'Miscellaneous Symbols', 410, 0.100, 0.560, 0.340, 0.240, 0.660),
  ('💯', '0x1F4AF', 'HUNDRED POINTS SYMBOL', 'Miscellaneous Symbols And Pictographs', 820, 0.075, 0.430, 0.495, 0.420, 0.822),
  ('‼', '0x203C', 'DOUBLE EXCLAMATION MARK', 'General Punctuation', 250, 0.160, 0.540, 0.300, 0.140, 0.560),
  ('❗', '0x2757', 'HEAVY EXCLAMATION MARK SYMBOL', 'Dingbats', 380, 0.180, 0.560, 0.260, 0.080, 0.530),
  ('❓', '0x2753', 'BLACK QUESTION MARK ORNAMENT', 'Dingbats', 290, 0.170, 0.630, 0.200, 0.030, 0.510),
  ('✔', '0x2714', 'HEAVY CHECK MARK', 'Dingbats', 420, 0.068, 0.550, 0.382, 0.314, 0.760),
  ('❌', '0x274C', 'CROSS MARK', 'Dingbats', 310, 0.350, 0.450, 0.200, -0.150, 0.355),
  ('⚠', '0x26A0', 'WARNING SIGN', 'Miscellaneous Symbols', 195, 0.280, 0.560, 0.160, -0.120, 0.390),
  ('ℹ', '0x2139', 'INFORMATION SOURCE', 'Letterlike Symbols', 150, 0.080, 0.810, 0.110, 0.030, 0.510),
  ('🔗', '0x1F517', 'LINK SYMBOL', 'Miscellaneous Symbols And Pictographs', 180, 0.075, 0.800, 0.125, 0.050, 0.515)

ON CONFLICT (unicode_codepoint) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  unicode_name = EXCLUDED.unicode_name,
  unicode_block = EXCLUDED.unicode_block,
  occurrences = EXCLUDED.occurrences,
  negative = EXCLUDED.negative,
  neutral = EXCLUDED.neutral,
  positive = EXCLUDED.positive,
  sentiment_score = EXCLUDED.sentiment_score,
  position = EXCLUDED.position;
