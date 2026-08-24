import type { TicketPick } from "./types";

export type SampleSlip = {
  id: string;
  title: string;
  blurb: string;
  text: string;
  picks: TicketPick[];
};

export const SAMPLE_SLIPS: SampleSlip[] = [
  {
    id: "weekend-fold",
    title: "Weekend football fold",
    blurb: "Eight legs. A few look like padding.",
    text: `Arsenal vs Manchester City
Premier League
1X2 Home @ 3.40

Liverpool vs Brighton
Premier League
Over 2.5 @ 1.62

Real Madrid vs Girona
La Liga
1X2 Home @ 1.22

Barcelona vs Valencia
La Liga
Both teams to score Yes @ 1.70

Inter vs Atalanta
Serie A
Draw @ 3.35

Bayern Munich vs Augsburg
Bundesliga
Over 2.5 @ 1.38

PSG vs Nantes
Ligue 1
1X2 Home @ 1.16

Napoli vs Fiorentina
Serie A
1X2 Home @ 1.72`,
    picks: [
      {
        id: "s1-1",
        sport: "football",
        league: "Premier League",
        home: "Arsenal",
        away: "Manchester City",
        market: "1X2",
        selection: "Home",
        odds: 3.4,
      },
      {
        id: "s1-2",
        sport: "football",
        league: "Premier League",
        home: "Liverpool",
        away: "Brighton",
        market: "Over/Under 2.5",
        selection: "Over 2.5",
        odds: 1.62,
      },
      {
        id: "s1-3",
        sport: "football",
        league: "La Liga",
        home: "Real Madrid",
        away: "Girona",
        market: "1X2",
        selection: "Home",
        odds: 1.22,
      },
      {
        id: "s1-4",
        sport: "football",
        league: "La Liga",
        home: "Barcelona",
        away: "Valencia",
        market: "Both teams to score",
        selection: "Yes",
        odds: 1.7,
      },
      {
        id: "s1-5",
        sport: "football",
        league: "Serie A",
        home: "Inter",
        away: "Atalanta",
        market: "1X2",
        selection: "Draw",
        odds: 3.35,
      },
      {
        id: "s1-6",
        sport: "football",
        league: "Bundesliga",
        home: "Bayern Munich",
        away: "Augsburg",
        market: "Over/Under 2.5",
        selection: "Over 2.5",
        odds: 1.38,
      },
      {
        id: "s1-7",
        sport: "football",
        league: "Ligue 1",
        home: "PSG",
        away: "Nantes",
        market: "1X2",
        selection: "Home",
        odds: 1.16,
      },
      {
        id: "s1-8",
        sport: "football",
        league: "Serie A",
        home: "Napoli",
        away: "Fiorentina",
        market: "1X2",
        selection: "Home",
        odds: 1.72,
      },
    ],
  },
  {
    id: "pitch-court",
    title: "Pitch and court",
    blurb: "Football, basketball, plus tennis that should be ignored.",
    text: `Manchester United vs Fulham
Premier League
Draw no bet Home @ 1.55

Chelsea vs Bournemouth
Premier League
Over 2.5 @ 1.70

Boston Celtics vs Milwaukee Bucks
NBA
Winner Home @ 1.65

Los Angeles Lakers vs Denver Nuggets
NBA
Total points Over 224.5 @ 1.90

Djokovic vs Alcaraz
ATP
Match winner Home @ 2.10

Golden State Warriors vs Oklahoma City Thunder
NBA
Winner Away @ 1.48`,
    picks: [
      {
        id: "s2-1",
        sport: "football",
        league: "Premier League",
        home: "Manchester United",
        away: "Fulham",
        market: "Draw no bet",
        selection: "Home",
        odds: 1.55,
      },
      {
        id: "s2-2",
        sport: "football",
        league: "Premier League",
        home: "Chelsea",
        away: "Bournemouth",
        market: "Over/Under 2.5",
        selection: "Over 2.5",
        odds: 1.7,
      },
      {
        id: "s2-3",
        sport: "basketball",
        league: "NBA",
        home: "Boston Celtics",
        away: "Milwaukee Bucks",
        market: "Winner",
        selection: "Home",
        odds: 1.65,
      },
      {
        id: "s2-4",
        sport: "basketball",
        league: "NBA",
        home: "Los Angeles Lakers",
        away: "Denver Nuggets",
        market: "Total points",
        selection: "Over 224.5",
        odds: 1.9,
      },
      {
        id: "s2-5",
        sport: "other",
        league: "ATP",
        home: "Djokovic",
        away: "Alcaraz",
        market: "Match winner",
        selection: "Home",
        odds: 2.1,
      },
      {
        id: "s2-6",
        sport: "basketball",
        league: "NBA",
        home: "Golden State Warriors",
        away: "Oklahoma City Thunder",
        market: "Winner",
        selection: "Away",
        odds: 1.48,
      },
    ],
  },
];
