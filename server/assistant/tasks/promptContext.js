const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(JSON.stringify(value)).length;
const omitted = (collection) => ({
  contentOmitted: true,
  historyCollection: collection,
});

/** Project a finite inference context without changing the saved goal or its authoritative evidence. */
export function authoringMessages(instructions, input, maximum) {
  const value = structuredClone(input);
  const messages = () => [
    { role: "system", content: instructions },
    { role: "user", content: JSON.stringify(value) },
  ];
  const fits = () => bytes(messages()) <= maximum;
  if (fits()) return messages();

  // Old tool results remain in their exact owned journals.
  while (value.build?.feedback?.length && !fits()) {
    value.build.feedback.shift();
    value.build.omittedFeedback = (value.build.omittedFeedback ?? 0) + 1;
  }
  if (fits()) return messages();
  if (value.build?.lastDecision)
    value.build.lastDecision = {
      kind: value.build.lastDecision.kind,
      contentOmitted: true,
    };
  if (fits()) return messages();

  while (
    value.questions?.some((question) => question.answer !== null) &&
    !fits()
  ) {
    const index = value.questions.findIndex(
      (question) => question.answer !== null,
    );
    value.questions.splice(index, 1);
    value.omittedQuestions = (value.omittedQuestions ?? 0) + 1;
  }
  if (fits()) return messages();

  for (const component of value.input.context.components) {
    if (fits()) break;
    delete component.source;
    component.sourceProjection = omitted("input");
  }
  if (fits()) return messages();
  if (value.input.examples.length) {
    value.input.examplesProjection = {
      ...omitted("input"),
      count: value.input.examples.length,
    };
    value.input.examples = [];
  }
  if (fits()) return messages();

  if (value.build?.reviewFeedback?.report) {
    const review = value.build.reviewFeedback;
    value.build.reviewFeedback = {
      ...omitted("reviews"),
      review: review.review,
      status: review.report?.status ?? "artifact_error",
    };
  }
  if (fits()) return messages();
  if (value.build?.agreement) {
    const { digest, body } = value.build.agreement;
    value.build.agreement = {
      ...omitted("agreement"),
      digest,
      description: body.description,
      operations: body.operations.map(
        ({ name, description, audience, access }) => ({
          name,
          description,
          audience,
          access,
        }),
      ),
    };
  }
  if (fits()) return messages();
  if (value.service) {
    value.service.operations = value.service.operations.map(
      ({ name, description, audience, access }) => ({
        name,
        description,
        audience,
        access,
      }),
    );
    value.service.agreementProjection = omitted("agreement");
  }
  if (fits()) return messages();
  throw Object.assign(
    new Error("Authoring context violates its bounded input contract."),
    { code: "invalid_result" },
  );
}
