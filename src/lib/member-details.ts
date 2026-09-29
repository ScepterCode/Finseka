import { shortDate } from "@/lib/format";

/** Extra, optional facts about a member. Organizations fill in only what they need. */
export type MemberDetails = {
  email: string;
  gender: string;
  dateOfBirth: string;
  address: string;
  occupation: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
};

export const emptyDetails: MemberDetails = {
  email: "",
  gender: "",
  dateOfBirth: "",
  address: "",
  occupation: "",
  nextOfKinName: "",
  nextOfKinPhone: "",
};

type DetailsRow = {
  email: string | null;
  gender: string | null;
  date_of_birth: string | null;
  address: string | null;
  occupation: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
};

export function detailsFromRow(row: Partial<DetailsRow>): MemberDetails {
  return {
    email: row.email ?? "",
    gender: row.gender ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    address: row.address ?? "",
    occupation: row.occupation ?? "",
    nextOfKinName: row.next_of_kin_name ?? "",
    nextOfKinPhone: row.next_of_kin_phone ?? "",
  };
}

export function detailsToRow(d: MemberDetails): DetailsRow {
  const clean = (v: string) => v.trim() || null;
  return {
    email: clean(d.email),
    gender: clean(d.gender),
    date_of_birth: clean(d.dateOfBirth),
    address: clean(d.address),
    occupation: clean(d.occupation),
    next_of_kin_name: clean(d.nextOfKinName),
    next_of_kin_phone: clean(d.nextOfKinPhone),
  };
}

/** The filled-in details as label/value pairs, for showing on the profile. */
export function detailsList(d: MemberDetails): { label: string; value: string }[] {
  return [
    { label: "Email", value: d.email },
    { label: "Gender", value: d.gender ? d.gender[0]!.toUpperCase() + d.gender.slice(1) : "" },
    { label: "Date of birth", value: d.dateOfBirth ? shortDate(d.dateOfBirth) : "" },
    { label: "Address", value: d.address },
    { label: "Occupation", value: d.occupation },
    {
      label: "Next of kin",
      value: [d.nextOfKinName, d.nextOfKinPhone].filter(Boolean).join(" · "),
    },
  ].filter((x) => x.value);
}
