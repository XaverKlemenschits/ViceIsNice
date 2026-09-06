# Implementation of Vice Is Nice Investment

Implement a single page application to do two things:
- Choose exactly 15 stocks to form a portfolio and save the choice in the browser
- Optimize the given portfolio by choosing weights using the Markowitz model

### Technical details

This will be a static web page, so all calculations need to be done in the frontend in java script. Use vanilla JavaScript, not any other framework or software around it.

Stocks should be selected based on (from high to low priority):
- Not overbought (RSI < 70)
- Upward momentum (50 day MA > 200 day MA)
- Low volatility (30 day σ < 20%)
- High liquidity (30 day volume > 1M shares)

More details on the stocks which should be chosen are described in FuntionalRequirements.md

### User interface

There should be a user settings field on the top, which is the same for each of the two main functionalities. It will include the settings for the Twelve Data API key.

Below should be a tabbed pane with two panes:
- Portfolio construction: Selects 15 stocks from a pre-determined list of at least 30 stocks from the equity universe. The pre-determined list will be hard-coded. The 15 chosen stocks should be stored to the browsers cache, so it is available later on.
- Portfolio optimisation: Selects the weights for each of the 15 stocks based on the latest available data

