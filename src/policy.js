export const HAZARDS = {
  sexual: "Does the text contain explicit sexual content, pornography, or a direct solicitation for sexual material? Do not flag neutral health education, non-explicit romance, or merely mentioning sexuality.",
  profanity: "Does the text contain profanity, vulgar insults, or obscene language?",
  hate: "Does the text promote hatred, dehumanization, or attacks against a person or group based on protected identity?",
  violence: "Does the text contain graphic violence, threats, or encouragement to harm someone?",
  self_harm: "Does the text encourage, instruct, or express intent to commit self-harm or suicide?",
  drugs: "Does the text solicit or provide instructions for obtaining or using illegal drugs?",
  spam: "Is the text primarily a scam, deceptive solicitation, or spam?"
};

export function makeVerdict(answers, { blockThreshold = 0.7, reviewThreshold = 0.35 } = {}) {
  const hazards = Object.fromEntries(
    Object.entries(answers ?? {}).map(([name, answer]) => [name, answer?.noul ?? 0])
  );
  const maxProbability = Math.max(0, ...Object.values(hazards));
  const matched = Object.entries(hazards)
    .filter(([, probability]) => probability >= reviewThreshold)
    .map(([category, probability]) => ({ category, probability }));

  return {
    action: maxProbability >= blockThreshold ? "block" : maxProbability >= reviewThreshold ? "review" : "allow",
    maxProbability,
    matched,
    hazards
  };
}
