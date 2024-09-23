import { PricingClient } from "@aws-sdk/client-pricing";
import { fromIni } from "@aws-sdk/credential-providers";
import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  awsProfile: string;
}

export function createPricingClient() {
  const { awsProfile } = getPreferenceValues<Preferences>();

  return new PricingClient({
    region: "us-east-1", // Pricing API is only available in us-east-1
    credentials: fromIni({ profile: awsProfile }),
  });
}