/**
 * Official Fantasy Premier League (FPL) Rules & Scoring Text
 * Directly ingested from https://fantasy.premierleague.com/help/rules
 * Unedited, comprehensive official reference for Gemini AI
 */

export const FPL_OFFICIAL_RULES_TEXT = `
### OFFICIAL FANTASY PREMIER LEAGUE RULES & SCORING GUIDELINES
(Source: fantasy.premierleague.com/help/rules)

1. MANAGING YOUR SQUAD & FORMATION RULES:
- Squad Size: 15 players (2 Goalkeepers, 5 Defenders, 5 Midfielders, 3 Forwards).
- Starting 11: From your 15-player squad, select 11 players by the Gameweek deadline.
- Valid Formations: Your Starting 11 must consist of at least 1 Goalkeeper, at least 3 Defenders, at least 2 Midfielders, and at least 1 Forward. Valid formations include 3-5-2, 3-4-3, 4-4-2, 4-3-3, 4-5-1, 5-3-2, 5-4-1, 5-2-3.
- Bench Order: 4 players remain on the bench (1 Substitute Goalkeeper and 3 Outfield Substitutes ordered by preference 1, 2, 3).
- Automatic Substitutions (Autosub): If a Starting 11 player does not play any minutes in the Gameweek (0 minutes), the system automatically substitutes them with the highest-priority bench player who played and keeps the formation valid.
- Bench Points: Points scored by bench players do not count towards the team score unless an automatic substitution occurs, or the Bench Boost chip is active.

2. CHOOSING YOUR CAPTAIN & VICE-CAPTAIN:
- Captain: Scores double points (2x multiplier).
- Triple Captain Chip: Scores triple points (3x multiplier).
- Vice-Captain (VC): If the chosen captain plays 0 minutes in the Gameweek, the captaincy and 2x multiplier automatically transfer to the Vice-Captain. If neither plays, no player's score is doubled.

3. TRANSFERS & PENALTY HITS:
- Free Transfers: Each Gameweek, managers receive 1 free transfer (which can accumulate up to 5 if unused).
- Transfer Hits (Penalties): Each additional transfer beyond the free transfer allocation incurs a deduction of 4 points (-4 pts) from the team's Gameweek score. Multiple extra transfers incur multiple -4 deductions (-8, -12, -16, etc.).
- Wildcard Chip: Allows unlimited permanent transfers in a Gameweek without any point deductions.
- Free Hit Chip: Allows unlimited transfers for a single Gameweek. At the next Gameweek deadline, your previous squad is completely restored.

4. CHIPS:
- Bench Boost: Points scored by all 4 bench players are included in your team total for the Gameweek.
- Triple Captain: Your captain's points are multiplied by 3 instead of 2.
- Free Hit: Unlimited transfers for 1 Gameweek only.
- Wildcard: Unlimited permanent transfers with no point hits.
- Only one chip can be played in any single Gameweek.

5. OFFICIAL SCORING SYSTEM & POINTS TABLE:
- Playing up to 59 minutes: 1 pt (all positions)
- Playing 60 minutes or more (excluding added injury time): 2 pts (all positions)
- Goal scored by a Goalkeeper (GKP) or Defender (DEF): 6 pts
- Goal scored by a Midfielder (MID): 5 pts
- Goal scored by a Forward (FWD): 4 pts
- Assist: 3 pts (for all positions: awarded to the player making the final pass, cross, header, rebound from shot, or being fouled for an officially converted penalty).
- Clean Sheet by a Goalkeeper or Defender: 4 pts (must play at least 60 minutes without the team conceding while the player is on the pitch).
- Clean Sheet by a Midfielder: 1 pt (must play at least 60 minutes without the team conceding while on the pitch).
- Clean Sheet by a Forward: 0 pts.
- Every 3 saves by a Goalkeeper: 1 pt (cumulative threshold: Math.floor(saves / 3) * 1).
- Penalty save by a Goalkeeper: 5 pts (directly stopping or parrying the penalty).
- Defensive Contribution (DefCon): 2 pts (DEF with >= 10 clearances, blocks, interceptions, and tackles [CBIT]; MID/FWD with >= 12 recoveries included [CBIRT]; capped at 2 pts per match).
- Every 2 goals conceded by Goalkeeper or Defender: -1 pt (cumulative threshold: -Math.floor(goals_conceded / 2) * 1).
- Penalty miss by shooter: -2 pts (saved or off target).
- Yellow Card: -1 pt.
- Red Card: -3 pts (direct red card or two yellow cards).
- Own Goal: -2 pts.
- Bonus Points (BPS Opta): 3, 2, or 1 point awarded to the top 3 highest-rated players in the official Opta Bonus Points System for that fixture.

6. SPECIAL SUBSTITUTION & RED CARD RULES:
- Clean Sheet on Early Substitution: If a player is substituted off after playing 60 minutes or more and their team has not conceded up to the minute of substitution, the player RETAINS the Clean Sheet point (+4 or +1), even if their team subsequently concedes after they leave the pitch.
- Red Card Conceded Goals: If a player receives a red card, they continue to be penalized for all goals conceded by their team after their ejection (-1 pt per 2 goals).

7. BONUS POINTS SYSTEM (BPS) TIE-BREAK RULES:
- Tie for 1st place in BPS: Player 1 and Player 2 both receive 3 bonus points; Player 3 receives 1 bonus point (no 2-point award).
- Tie for 2nd place in BPS: Player 1 receives 3 points; Player 2 and Player 3 both receive 2 bonus points.
- Tie for 3rd place in BPS: Player 1 receives 3 points; Player 2 receives 2 points; Player 3 and Player 4 both receive 1 bonus point.
- 3-way tie for 1st place: All three players receive 3 bonus points; no 2 or 1 point awards.
`;
