import { useState, useEffect } from "react";
import { loadSharedConfigFiles } from "@aws-sdk/shared-ini-file-loader";
import { List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";

export interface ProfileOption {
  name: string;
  region?: string;
}

export const useProfileOptions = (): ProfileOption[] => {
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);

  useEffect(() => {
    const fetchProfileOptions = async () => {
      try {
        const { configFile, credentialsFile } = await loadSharedConfigFiles();
        const profiles = Object.keys(configFile).length > 0 ? configFile : credentialsFile;

        const options = Object.entries(profiles).map(([name, config]) => ({
          name,
          region: config.region,
        }));

        setProfileOptions(options);
      } catch (error) {
        console.error("Error loading AWS profiles:", error);
      }
    };

    fetchProfileOptions();
  }, []);

  return profileOptions;
};

export const useAwsProfileDropdown = (defaultProfile: string, onProfileChange: (newProfile: string) => void) => {
  const [selectedProfile, setSelectedProfile] = useCachedState<string>("aws_profile", defaultProfile);
  const profileOptions = useProfileOptions();

  const handleProfileChange = (newProfile: string) => {
    setSelectedProfile(newProfile);
    onProfileChange(newProfile);
  };

  const dropdown = (
    <List.Dropdown tooltip="Select AWS Profile" onChange={handleProfileChange} value={selectedProfile}>
      {profileOptions.map((profile) => (
        <List.Dropdown.Item key={profile.name} value={profile.name} title={profile.name} />
      ))}
    </List.Dropdown>
  );

  return { selectedProfile, dropdown };
};
