// Who Said It: one prompt about each person, with their first name in it. Everyone else answers it; then the person
// guesses who wrote what about them. Playful roasts only: nothing about bodies, money troubles, exes, or anything
// that would sting. Ids are what the server keeps (said-NN), so never renumber one; add new ones at the end.
export type SaidPrompt = { id: string; text: string };

export const SAID: SaidPrompt[] = [
  { id: 'said-01', text: "{name}'s secret talent" },
  { id: 'said-02', text: 'What {name} was in a past life' },
  { id: 'said-03', text: 'The warning label on {name}' },
  { id: 'said-04', text: "{name}'s go-to karaoke song" },
  { id: 'said-05', text: 'The first thing {name} buys with a million dollars' },
  { id: 'said-06', text: "{name}'s villain origin story" },
  { id: 'said-07', text: "The title of {name}'s memoir" },
  { id: 'said-08', text: 'The reality show {name} would win' },
  { id: 'said-09', text: 'What {name} is doing at 2 in the morning' },
  { id: 'said-10', text: 'The animal {name} would be' },
  { id: 'said-11', text: 'The worst job in the world for {name}' },
  { id: 'said-12', text: 'What {name} brings to a desert island' },
  { id: 'said-13', text: "{name}'s signature dance move" },
  { id: 'said-14', text: "{name}'s hottest take" },
  { id: 'said-15', text: 'The movie {name} has seen way too many times' },
  { id: 'said-16', text: 'What {name} would name a boat' },
  { id: 'said-17', text: "{name}'s catchphrase" },
  { id: 'said-18', text: 'The award {name} deserves' },
  { id: 'said-19', text: 'What {name} orders at a drive through' },
  { id: 'said-20', text: "{name}'s biggest pet peeve" },
  { id: 'said-21', text: 'The song that plays when {name} walks in' },
  { id: 'said-22', text: 'What {name} will be famous for' },
  { id: 'said-23', text: 'How long {name} lasts in a zombie movie' },
  { id: 'said-24', text: "{name}'s guilty pleasure" },
  { id: 'said-25', text: 'The name of the band {name} fronts' },
  { id: 'said-26', text: "{name}'s most unpopular opinion" },
  { id: 'said-27', text: 'The holiday {name} would invent' },
  { id: 'said-28', text: 'What {name} is overthinking right now' },
  { id: 'said-29', text: "{name}'s perfect Saturday" },
  { id: 'said-30', text: "The first rule of {name}'s house" },
  { id: 'said-31', text: 'The cartoon character {name} basically is' },
  { id: 'said-32', text: "{name}'s superpower, and its catch" },
  { id: 'said-33', text: '{name} before coffee, in three words' },
  { id: 'said-34', text: "{name}'s most dramatic moment" },
  { id: 'said-35', text: 'The class {name} could teach' },
  { id: 'said-36', text: 'What {name} whispers to their plants' },
  { id: 'said-37', text: "What {name}'s billboard says" },
  { id: 'said-38', text: 'The thing {name} would win a gold medal in' },
  { id: 'said-39', text: "{name}'s group chat nickname" },
  { id: 'said-40', text: "{name}'s one wish" },
];

const byId = new Map(SAID.map(p => [p.id, p]));
/** The prompt, with their first name in it. */
export function saidPrompt(id: string | null | undefined, name: string): string {
  const p = id ? byId.get(id) : undefined;
  return (p?.text || 'Something about {name}').replace(/\{name\}/g, name);
}
