import { ChallengeView } from "./_ChallengeView";

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    // No bottom tab bar — matches native (sub-screens opt out). Back via header.
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <ChallengeView assignmentId={id} />
    </main>
  );
}
