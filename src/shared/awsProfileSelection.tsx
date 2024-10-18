import { useState, useEffect } from "react";
import { List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { loadSharedConfigFiles } from "@aws-sdk/shared-ini-file-loader";

export type ProfileOption = {
  name: string;
  region?: string;
  source_profile?: string;
  sso_start_url?: string;
  sso_account_id?: string;
  sso_role_name?: string;
  sso_session?: string;
};

export function ProfileDropdown({ onProfileChange }: { onProfileChange: (newProfile: string) => void }) {
  const [selectedProfile, setSelectedProfile] = useCachedState<string>("aws_profile");
  const profileOptions = useProfileOptions();

  useEffect(() => {
    const isSelectedProfileInvalid =
      selectedProfile && !profileOptions.some((profile) => profile.name === selectedProfile);

    if (!selectedProfile || isSelectedProfileInvalid) {
      setSelectedProfile(profileOptions[0]?.name);
    }
  }, [profileOptions, selectedProfile]);

  useEffect(() => {
    if (selectedProfile) {
      onProfileChange(selectedProfile);
    }
  }, [selectedProfile, onProfileChange]);

  if (!profileOptions || profileOptions.length < 2) {
    return null;
  }

  return (
    <List.Dropdown
      tooltip="Select AWS Profile"
      value={selectedProfile}
      onChange={setSelectedProfile}
    >
      {profileOptions.map((profile) => (
        <List.Dropdown.Item
          key={profile.name}
          value={profile.name}
          title={profile.name}
        />
      ))}
    </List.Dropdown>
  );
}

export const useProfileOptions = (): ProfileOption[] => {
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);

  useEffect(() => {
    const fetchProfileOptions = async () => {
      try {
        const { configFile, credentialsFile } = await loadSharedConfigFiles();
        const profiles = Object.keys(configFile).length > 0 ? configFile : credentialsFile;

        const options = Object.entries(profiles).map(([name, config]) => {
          const region = config.region;
          return { ...config, region, name };
        });

        setProfileOptions(options);
      } catch (error) {
        console.error("Error loading AWS profiles:", error);
      }
    };

    fetchProfileOptions();
  }, []);

  return profileOptions;
};
